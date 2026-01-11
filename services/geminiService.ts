import { GoogleGenAI, Modality, Type, FunctionDeclaration, LiveServerMessage } from "@google/genai";
import { InterviewQA } from "../types";
import { createBlob, createImageBlob } from "./audioUtils";

interface LiveConnectionCallbacks {
  onOpen: () => void;
  onMatch: (questionId: string) => void;
  onAiAnswer: (answer: string, question: string) => void;
  onTranscriptUpdate: (text: string) => void;
  onTranscriptCommit: (text: string, speaker: 'interviewer' | 'you') => void;
  onTokenUpdate: (input: number, output: number) => void;
  onError: (e: Error) => void;
  onClose: () => void;
  // Streaming text callbacks
  onTextChunk?: (chunk: string) => void;
  onStreamingStart?: (question: string) => void;
  onStreamingEnd?: () => void;
  // RAG context retrieval - returns relevant context for the question
  onRetrieveContext?: (question: string) => Promise<string>;
}

// Config for Electron mode system audio
export interface ElectronAudioConfig {
  systemAudioSource: string; // PulseAudio source ID
}

// Video capture configuration
export interface VideoConfig {
  enabled: boolean;
  frameRate?: number; // Frames per second (default: 1)
  quality?: number;   // JPEG quality 0-1 (default: 0.7)
  maxWidth?: number;  // Max frame width (default: 1280)
  maxHeight?: number; // Max frame height (default: 720)
}

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNodes: MediaStreamAudioSourceNode[] = [];
  private sessionPromise: Promise<any> | null = null;
  private isConnected: boolean = false;
  private currentTranscript: string = "";

  // Streaming answer state
  private isStreamingAnswer: boolean = false;
  private streamingQuestion: string = "";
  private streamedAnswerBuffer: string = "";

  // Speaker Detection
  private systemAnalyser: AnalyserNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private systemEnergy = 0;
  private micEnergy = 0;

  // Track cumulative usage
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  // Electron mode: IPC audio handling
  private electronMode: boolean = false;
  private systemAudioBuffer: Float32Array[] = [];
  private systemAudioGain: GainNode | null = null;

  // Video capture
  private videoStream: MediaStream | null = null;
  private videoCanvas: HTMLCanvasElement | null = null;
  private videoContext: CanvasRenderingContext2D | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private videoFrameInterval: ReturnType<typeof setInterval> | null = null;
  private videoConfig: VideoConfig = { enabled: false };

  // RAG callback
  private onRetrieveContext: ((question: string) => Promise<string>) | null = null;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async connect(
    streams: { system?: MediaStream; mic?: MediaStream; video?: MediaStream },
    modelId: string,
    systemInstruction: string,
    callbacks: LiveConnectionCallbacks,
    electronConfig?: ElectronAudioConfig,
    videoConfig?: VideoConfig
  ) {
    if (this.isConnected) return;

    // Reset stats
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.systemEnergy = 0;
    this.micEnergy = 0;
    this.systemAudioBuffer = [];

    // Store RAG callback
    this.onRetrieveContext = callbacks.onRetrieveContext || null;

    // Store video config
    this.videoConfig = videoConfig || { enabled: false };

    // Check if running in Electron mode (Linux only - Windows uses MediaStream directly)
    const isLinux = window.electronAPI?.platform === 'linux';
    this.electronMode = !!electronConfig && !!window.electronAPI && isLinux;

    // Tool 1: Knowledge Base Match
    const selectQuestionTool: FunctionDeclaration = {
      name: 'selectQuestion',
      description: 'Use this when the user asks a question that closely matches one in the provided Cheat Sheet.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          questionId: { type: Type.STRING },
        },
        required: ['questionId'],
      },
    };

    // Tool 2: Signal to generate a streaming answer with RAG context
    const generateAnswerTool: FunctionDeclaration = {
      name: 'generateAnswer',
      description: 'Use this when the user asks a valid interview question that is NOT in the Cheat Sheet. The tool will return relevant context from the candidate\'s background (activities, CV, etc.). Use that context to generate a personalized answer as streaming text.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING, description: "The question asked by the interviewer" },
        },
        required: ['question'],
      },
    };

    try {
      this.sessionPromise = this.ai.live.connect({
        model: modelId,
        config: {
          systemInstruction: systemInstruction,
          responseModalities: [Modality.TEXT], // Changed from AUDIO to TEXT for streaming
          tools: [{ functionDeclarations: [selectQuestionTool, generateAnswerTool] }],
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
            languageCode: 'en-US' // Enforce English
          }
        },
        callbacks: {
          onopen: () => {
            this.isConnected = true;
            callbacks.onOpen();
            this.startAudioMixing(streams, electronConfig);
            // Start video capture if enabled
            if (this.videoConfig.enabled && streams.video) {
              this.startVideoCapture(streams.video);
            }
          },
          onmessage: (message: LiveServerMessage) => {
            // 1. Handle Usage Metadata
            const usage = (message as any).usageMetadata || (message.serverContent as any)?.usageMetadata;
            if (usage) {
               if (usage.totalTokenCount) {
                  this.totalInputTokens = usage.promptTokenCount || 0;
                  this.totalOutputTokens = usage.candidatesTokenCount || 0;
               } else {
                  const input = usage.promptTokenCount || usage.inputTokens || 0;
                  const output = usage.candidatesTokenCount || usage.outputTokens || 0;
                  this.totalInputTokens = input;
                  this.totalOutputTokens = output;
               }
               callbacks.onTokenUpdate(this.totalInputTokens, this.totalOutputTokens);
            }

            // 2. Handle Tool Calls
            if (message.toolCall) {
              message.toolCall.functionCalls.forEach(fc => {
                if (fc.name === 'selectQuestion') {
                  const qId = (fc.args as any).questionId;
                  if (qId) callbacks.onMatch(qId);
                } else if (fc.name === 'generateAnswer') {
                  // Signal that streaming is starting
                  const args = fc.args as any;
                  if (callbacks.onStreamingStart) {
                    callbacks.onStreamingStart(args.question);
                  }
                  this.isStreamingAnswer = true;
                  this.streamingQuestion = args.question;
                  this.streamedAnswerBuffer = '';

                  // RAG: Retrieve relevant context and include in tool response
                  if (this.onRetrieveContext && this.sessionPromise) {
                    this.onRetrieveContext(args.question).then(context => {
                      this.sessionPromise!.then(session => {
                        session.sendToolResponse({
                          functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: {
                              result: 'ok',
                              relevantContext: context || 'No specific context found. Use your general knowledge of the candidate.'
                            }
                          }
                        });
                      }).catch(e => {
                        console.error("Failed to send tool response:", e);
                      });
                    }).catch(e => {
                      console.error("Failed to retrieve context:", e);
                      // Send response without context on error
                      this.sessionPromise!.then(session => {
                        session.sendToolResponse({
                          functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: { result: 'ok' }
                          }
                        });
                      });
                    });
                    return; // Don't send default response below
                  }
                }

                if (this.sessionPromise) {
                  this.sessionPromise.then(session => {
                    session.sendToolResponse({
                      functionResponses: {
                        id: fc.id,
                        name: fc.name,
                        response: { result: 'ok' }
                      }
                    });
                  }).catch(e => {
                      console.error("Failed to send tool response:", e);
                  });
                }
              });
            }

            // 2.5. Handle streaming text output (for generated answers)
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.text && this.isStreamingAnswer) {
                  this.streamedAnswerBuffer += part.text;
                  if (callbacks.onTextChunk) {
                    callbacks.onTextChunk(part.text);
                  }
                }
              }
            }

            // 3. Handle Transcription
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              if (text) {
                this.currentTranscript += text;
                callbacks.onTranscriptUpdate(this.currentTranscript);
              }
            }

            // 4. Handle Turn Complete
            if (message.serverContent?.turnComplete) {
              // Finalize streamed answer if we were streaming
              if (this.isStreamingAnswer && this.streamedAnswerBuffer.trim()) {
                callbacks.onAiAnswer(this.streamedAnswerBuffer, this.streamingQuestion);
                if (callbacks.onStreamingEnd) {
                  callbacks.onStreamingEnd();
                }
                this.isStreamingAnswer = false;
                this.streamingQuestion = "";
                this.streamedAnswerBuffer = "";
              }

              if (this.currentTranscript.trim()) {
                // Determine dominant speaker
                const speaker = this.systemEnergy >= this.micEnergy ? 'interviewer' : 'you';

                callbacks.onTranscriptCommit(this.currentTranscript, speaker);

                // Reset logic
                this.currentTranscript = "";
                this.systemEnergy = 0;
                this.micEnergy = 0;
              }
            }
          },
          onclose: () => {
            console.log("Gemini session closed");
            this.cleanup();
            callbacks.onClose();
          },
          onerror: (e) => {
            console.error('Gemini Live Error:', e);
            // Catch "Deadline expired" specific string if possible, though 'e' might be generic
            this.cleanup();
            callbacks.onError(new Error(e.message || "Connection error"));
          }
        }
      });
      
      await this.sessionPromise;

    } catch (error) {
      this.cleanup();
      callbacks.onError(error instanceof Error ? error : new Error("Failed to connect"));
    }
  }

  private startAudioMixing(
    streams: { system?: MediaStream; mic?: MediaStream },
    electronConfig?: ElectronAudioConfig
  ) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 16000,
    });

    // Create mixer
    const mixer = this.audioContext.createGain();

    // 1. Setup System Audio
    if (this.electronMode && electronConfig) {
      // Electron mode: Set up IPC listener for system audio
      this.setupElectronSystemAudio(mixer, electronConfig.systemAudioSource);
    } else if (streams.system) {
      // Web mode: Use MediaStream
      const source = this.audioContext.createMediaStreamSource(streams.system);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(mixer);

      this.systemAnalyser = analyser;
      this.sourceNodes.push(source);
    }

    // 2. Setup Mic Audio (same for both modes - uses getUserMedia)
    if (streams.mic) {
      const source = this.audioContext.createMediaStreamSource(streams.mic);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(mixer);

      this.micAnalyser = analyser;
      this.sourceNodes.push(source);
    }

    // 3. Setup Processor
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    mixer.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    // Reusable buffers for energy calculation
    const sysData = new Float32Array(256);
    const micData = new Float32Array(256);

    this.processor.onaudioprocess = (e) => {
      if (!this.isConnected || !this.sessionPromise) return;

      // In Electron mode, mix IPC audio buffer with processor output
      let inputData = e.inputBuffer.getChannelData(0);

      if (this.electronMode && this.systemAudioBuffer.length > 0) {
        // Mix system audio from IPC buffer
        const systemChunk = this.systemAudioBuffer.shift();
        if (systemChunk) {
          // Calculate system energy from IPC audio
          this.systemEnergy += this.calculateRMS(systemChunk);

          // Mix system audio into input (already has mic from processor)
          const mixedData = new Float32Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const sysVal = i < systemChunk.length ? systemChunk[i] : 0;
            mixedData[i] = (inputData[i] + sysVal) * 0.5; // Average mix
          }
          inputData = mixedData;
        }
      }

      // 1. Send Audio to Gemini
      const pcmBlob = createBlob(inputData);

      this.sessionPromise.then((session) => {
        // Double check connected state before sending to avoid "Deadline exceeded" on closed pipes
        if (this.isConnected) {
          session.sendRealtimeInput({ media: pcmBlob });
        }
      }).catch(err => {
        // Swallow send errors if we are closing, otherwise log
        if (this.isConnected) console.warn("Error sending audio frame:", err);
      });

      // 2. Calculate Energy for Speaker Detection
      if (this.systemAnalyser) {
        this.systemAnalyser.getFloatTimeDomainData(sysData);
        this.systemEnergy += this.calculateRMS(sysData);
      }
      if (this.micAnalyser) {
        this.micAnalyser.getFloatTimeDomainData(micData);
        this.micEnergy += this.calculateRMS(micData);
      }
    };
  }

  // Set up Electron IPC listener for system audio from PulseAudio
  private setupElectronSystemAudio(mixer: GainNode, sourceId: string) {
    if (!window.electronAPI || !this.audioContext) return;

    // Start system audio capture via IPC
    window.electronAPI.startSystemAudio(sourceId).then(success => {
      if (!success) {
        console.error('Failed to start system audio capture');
        return;
      }
      console.log('System audio capture started for source:', sourceId);
    });

    // Create analyser for system audio energy tracking
    this.systemAnalyser = this.audioContext.createAnalyser();
    this.systemAnalyser.fftSize = 256;

    // Listen for audio data from main process
    window.electronAPI.onSystemAudioData((data: Buffer) => {
      if (!this.isConnected) return;

      // Convert Int16 PCM buffer to Float32 array
      const int16Data = new Int16Array(
        data.buffer,
        data.byteOffset,
        data.byteLength / 2
      );
      const float32Data = new Float32Array(int16Data.length);

      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0; // Normalize to -1.0 to 1.0
      }

      // Queue for mixing in audio processor
      this.systemAudioBuffer.push(float32Data);

      // Keep buffer reasonable (drop old data if too much builds up)
      while (this.systemAudioBuffer.length > 10) {
        this.systemAudioBuffer.shift();
      }
    });

    // Handle capture errors
    window.electronAPI.onAudioCaptureError((error: string) => {
      console.error('System audio capture error:', error);
    });
  }

  private calculateRMS(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  /**
   * Start capturing video frames and sending to Gemini
   */
  private startVideoCapture(videoStream: MediaStream) {
    this.videoStream = videoStream;

    // Get config with defaults
    const frameRate = this.videoConfig.frameRate || 1; // 1 fps default
    const quality = this.videoConfig.quality || 0.7;
    const maxWidth = this.videoConfig.maxWidth || 1280;
    const maxHeight = this.videoConfig.maxHeight || 720;

    // Create video element to receive stream
    this.videoElement = document.createElement('video');
    this.videoElement.srcObject = videoStream;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;

    // Create canvas for frame capture
    this.videoCanvas = document.createElement('canvas');
    this.videoContext = this.videoCanvas.getContext('2d');

    this.videoElement.onloadedmetadata = () => {
      if (!this.videoElement || !this.videoCanvas || !this.videoContext) return;

      // Calculate scaled dimensions
      let width = this.videoElement.videoWidth;
      let height = this.videoElement.videoHeight;

      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (maxHeight / height) * width;
        height = maxHeight;
      }

      this.videoCanvas.width = width;
      this.videoCanvas.height = height;

      console.log(`Video capture started: ${width}x${height} @ ${frameRate}fps`);

      // Start frame capture interval
      const intervalMs = 1000 / frameRate;
      this.videoFrameInterval = setInterval(() => {
        this.captureAndSendFrame(quality);
      }, intervalMs);
    };

    this.videoElement.play().catch(e => {
      console.error('Failed to start video playback:', e);
    });
  }

  /**
   * Capture a single frame and send to Gemini
   */
  private captureAndSendFrame(quality: number) {
    if (!this.isConnected || !this.sessionPromise) return;
    if (!this.videoElement || !this.videoCanvas || !this.videoContext) return;

    // Draw current frame to canvas
    this.videoContext.drawImage(
      this.videoElement,
      0, 0,
      this.videoCanvas.width,
      this.videoCanvas.height
    );

    // Convert to base64 JPEG
    const imageBlob = createImageBlob(this.videoCanvas, quality);

    // Send to Gemini
    this.sessionPromise.then(session => {
      if (this.isConnected) {
        session.sendRealtimeInput({ media: imageBlob });
      }
    }).catch(err => {
      if (this.isConnected) console.warn("Error sending video frame:", err);
    });
  }

  /**
   * Stop video capture
   */
  private stopVideoCapture() {
    if (this.videoFrameInterval) {
      clearInterval(this.videoFrameInterval);
      this.videoFrameInterval = null;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }

    this.videoCanvas = null;
    this.videoContext = null;
  }

  public disconnect() {
    this.cleanup();
  }

  private cleanup() {
    this.isConnected = false;
    this.currentTranscript = "";
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.systemEnergy = 0;
    this.micEnergy = 0;
    this.systemAudioBuffer = [];
    this.isStreamingAnswer = false;
    this.streamingQuestion = "";
    this.streamedAnswerBuffer = "";

    // Stop video capture
    this.stopVideoCapture();
    this.videoConfig = { enabled: false };
    this.onRetrieveContext = null;

    // Stop Electron system audio capture
    if (this.electronMode && window.electronAPI) {
      window.electronAPI.stopSystemAudio();
      window.electronAPI.removeSystemAudioListener();
    }
    this.electronMode = false;

    this.sourceNodes.forEach(node => node.disconnect());
    this.sourceNodes = [];

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.systemAudioGain) {
      this.systemAudioGain.disconnect();
      this.systemAudioGain = null;
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext.close();
      }
      this.audioContext = null;
    }

    this.sessionPromise = null;
    this.systemAnalyser = null;
    this.micAnalyser = null;
  }
}