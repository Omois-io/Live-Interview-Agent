import { GoogleGenAI, Modality, Type, FunctionDeclaration, LiveServerMessage } from "@google/genai";
import { InterviewQA } from "../types";
import { createBlob } from "./audioUtils";
import { logger } from "./logger";

interface LiveConnectionCallbacks {
  onOpen: () => void;
  onMatch: (questionId: string) => void;
  onAiAnswer: (answer: string, question: string) => void;
  onTranscriptUpdate: (text: string) => void;
  onTranscriptCommit: (text: string, speaker: 'interviewer' | 'you') => void;
  onTokenUpdate: (tokenData: {
    textInput: number;
    audioVideoInput: number;
    textOutput: number;
    audioOutput: number;
    totalInput: number;
    totalOutput: number;
  }) => void;
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

  // Track modality-specific tokens (for accurate pricing)
  private textInputTokens = 0;
  private audioVideoInputTokens = 0;
  private textOutputTokens = 0;
  private audioOutputTokens = 0;

  // Track audio/video duration for fallback estimation
  private audioInputDuration = 0;  // seconds
  private videoInputDuration = 0;  // seconds
  private sessionStartTime = 0;    // timestamp

  // Electron mode: IPC audio handling
  private electronMode: boolean = false;
  private systemAudioBuffer: Float32Array[] = [];
  private systemAudioGain: GainNode | null = null;


  // RAG callback
  private onRetrieveContext: ((question: string) => Promise<string>) | null = null;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async connect(
    streams: { system?: MediaStream; mic?: MediaStream },
    modelId: string,
    systemInstruction: string,
    callbacks: LiveConnectionCallbacks,
    electronConfig?: ElectronAudioConfig
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

    logger.info(`Attempting to connect to Gemini Live API: ${modelId}`);
    logger.info(`Has system stream: ${!!streams.system}, Has mic stream: ${!!streams.mic}`);

    try {
      this.sessionPromise = this.ai.live.connect({
        model: modelId,
        config: {
          systemInstruction: systemInstruction,
          responseModalities: [Modality.TEXT], // TEXT for streaming responses
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
            this.sessionStartTime = Date.now();
            callbacks.onOpen();
            this.startAudioMixing(streams, electronConfig);
          },
          onmessage: (message: LiveServerMessage) => {
            // Log all incoming messages for debugging
            logger.info(`Received message from Gemini: ${JSON.stringify(message).substring(0, 500)}`);

            // 1. Handle Usage Metadata
            const usage = (message as any).usageMetadata || (message.serverContent as any)?.usageMetadata;
            if (usage) {
               console.log('[Token Debug] Usage metadata received:', JSON.stringify(usage));

               // Update total tokens
               if (usage.totalTokenCount) {
                  this.totalInputTokens = usage.promptTokenCount || 0;
                  this.totalOutputTokens = usage.candidatesTokenCount || 0;
               } else {
                  const input = usage.promptTokenCount || usage.inputTokens || 0;
                  const output = usage.candidatesTokenCount || usage.outputTokens || 0;
                  this.totalInputTokens = input;
                  this.totalOutputTokens = output;
               }

               // Try to extract modality-specific tokens
               const modalityBreakdown = usage.modalities || usage.modalityBreakdown;

               if (modalityBreakdown) {
                  // API provides modality breakdown - use it directly
                  console.log('[Token Debug] Modality breakdown found:', JSON.stringify(modalityBreakdown));

                  this.textInputTokens = modalityBreakdown.TEXT?.input || 0;
                  this.audioVideoInputTokens = (modalityBreakdown.AUDIO?.input || 0) + (modalityBreakdown.VIDEO?.input || 0);
                  this.textOutputTokens = modalityBreakdown.TEXT?.output || 0;
                  this.audioOutputTokens = modalityBreakdown.AUDIO?.output || 0;
               } else {
                  // No modality breakdown - estimate based on session duration
                  console.log('[Token Debug] No modality breakdown - estimating from duration');

                  const elapsedSeconds = this.sessionStartTime > 0
                    ? (Date.now() - this.sessionStartTime) / 1000
                    : 0;

                  // Estimate audio tokens (assuming audio is always present)
                  const estimatedAudioTokens = Math.floor(elapsedSeconds * 32); // 32 tokens/sec

                  // Remaining tokens are text (no video)
                  this.audioVideoInputTokens = estimatedAudioTokens;
                  this.textInputTokens = Math.max(0, this.totalInputTokens - this.audioVideoInputTokens);

                  // Assume output is mostly text (conservative estimate)
                  this.textOutputTokens = this.totalOutputTokens;
                  this.audioOutputTokens = 0;

                  console.log(`[Token Debug] Estimated - Audio: ${estimatedAudioTokens}, Text Input: ${this.textInputTokens}`);
               }

               console.log(`[Token Debug] Tokens breakdown: TextIn=${this.textInputTokens}, A/V In=${this.audioVideoInputTokens}, TextOut=${this.textOutputTokens}, AudioOut=${this.audioOutputTokens}`);

               callbacks.onTokenUpdate({
                  textInput: this.textInputTokens,
                  audioVideoInput: this.audioVideoInputTokens,
                  textOutput: this.textOutputTokens,
                  audioOutput: this.audioOutputTokens,
                  totalInput: this.totalInputTokens,
                  totalOutput: this.totalOutputTokens
               });
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
                        logger.error("Failed to send tool response:", e);
                      });
                    }).catch(e => {
                      logger.error("Failed to retrieve context:", e);
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
                      logger.error("Failed to send tool response:", e);
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
          onclose: (event: any) => {
            logger.info("Gemini session closed");
            logger.info(`Session lasted: ${this.isConnected ? (Date.now() - this.sessionStartTime) + 'ms' : '0ms'}`);
            logger.info(`Was connected: ${this.isConnected}`);
            // Log close event details if available
            if (event) {
              logger.info(`Close event: ${JSON.stringify(event)}`);
              logger.info(`Close code: ${event.code}, reason: ${event.reason}`);
            }
            this.cleanup();
            callbacks.onClose();
          },
          onerror: (e: any) => {
            logger.error('Gemini Live Error:', e);
            logger.error('Error type:', typeof e);
            logger.error('Error details:', JSON.stringify(e, null, 2));
            if (e.code) logger.error('Error code:', e.code);
            if (e.reason) logger.error('Error reason:', e.reason);
            if (e.message) logger.error('Error message:', e.message);
            this.cleanup();
            callbacks.onError(new Error(e.message || "Connection error"));
          }
        }
      });
      
      await this.sessionPromise;

    } catch (error) {
      logger.error('Failed to establish Gemini Live connection:', error);
      logger.error('Model ID:', modelId);
      this.cleanup();
      callbacks.onError(error instanceof Error ? error : new Error("Failed to connect"));
    }
  }

  private startAudioMixing(
    streams: { system?: MediaStream; mic?: MediaStream },
    electronConfig?: ElectronAudioConfig
  ) {
    logger.info(`Starting audio mixing - System: ${!!streams.system}, Mic: ${!!streams.mic}, Electron mode: ${this.electronMode}`);

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 16000,
    });

    logger.info(`AudioContext created, sample rate: ${this.audioContext.sampleRate}`);

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

    // 4. Send initial audio packet immediately to keep connection alive
    // The ScriptProcessor takes ~256ms to fire first callback, but Gemini expects audio sooner
    const initialSilence = new Float32Array(4096); // Silent buffer
    const initialBlob = createBlob(initialSilence);
    logger.info('Sending initial audio packet to keep connection alive');
    this.sessionPromise?.then((session) => {
      if (this.isConnected) {
        session.sendRealtimeInput([initialBlob]); // Use array format
        logger.info('Initial audio packet sent successfully');
      }
    }).catch(err => {
      logger.error('Failed to send initial audio packet:', err);
    });

    // Reusable buffers for energy calculation
    const sysData = new Float32Array(256);
    const micData = new Float32Array(256);

    // Add counter for periodic logging
    let audioProcessCount = 0;
    let totalBlobsSent = 0;

    this.processor.onaudioprocess = (e) => {
      if (!this.isConnected || !this.sessionPromise) return;

      audioProcessCount++;

      // Log every 100 audio frames (~6 seconds at 4096 buffer size)
      if (audioProcessCount % 100 === 1) {
        logger.info(`Audio processing active - Frame ${audioProcessCount}, Blobs sent: ${totalBlobsSent}`);
      }

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
      totalBlobsSent++;

      // Log first few blobs and periodically after
      if (totalBlobsSent <= 5 || totalBlobsSent % 100 === 0) {
        logger.info(`Sending audio blob #${totalBlobsSent}, size: ${pcmBlob.data.length} bytes`);
      }

      this.sessionPromise.then((session) => {
        // Double check connected state before sending to avoid "Deadline exceeded" on closed pipes
        if (this.isConnected) {
          session.sendRealtimeInput([pcmBlob]); // Use array format
        } else {
          if (totalBlobsSent <= 5) {
            logger.warn(`Attempted to send blob #${totalBlobsSent} but not connected`);
          }
        }
      }).catch(err => {
        // Swallow send errors if we are closing, otherwise log
        if (this.isConnected) {
          logger.error(`Error sending audio blob #${totalBlobsSent} to Gemini:`, err);
          logger.error('Error details:', JSON.stringify(err, null, 2));
        }
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
        logger.error('Failed to start system audio capture');
        return;
      }
      logger.info('System audio capture started for source:', sourceId);
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
      logger.error('System audio capture error:', error);
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
   * Inject text into the live session (e.g., a question detected from screen scan)
   */
  public async injectText(text: string): Promise<void> {
    if (!this.isConnected || !this.sessionPromise) {
      logger.warn('Cannot inject text - not connected');
      return;
    }

    logger.info(`Injecting text into live session: ${text.substring(0, 100)}...`);

    try {
      const session = await this.sessionPromise;
      // Send as client content (user message)
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true
      });
    } catch (err) {
      logger.error('Failed to inject text:', err);
    }
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