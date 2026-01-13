import React, { useState, useEffect, useRef, useCallback } from 'react';
import { INITIAL_QUESTIONS, LIVE_MODELS } from './constants';
import { InterviewQA, ConnectionState, TranscriptItem, TokenStats, KnowledgeItem } from './types';
import { GeminiLiveService } from './services/geminiService';
import { ScreenScannerService } from './services/screenScannerService';
import { EmbeddingService, EmbeddedChunk, EmbeddingMatch } from './services/embeddingService';
import { KnowledgeService } from './services/knowledgeService';
import { QuestionList } from './components/QuestionList';
import { Visualizer } from './components/Visualizer';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ContextModal } from './components/ContextModal';
import { RecordingPanel } from './components/RecordingPanel';
import { LiveAnswerPanel } from './components/LiveAnswerPanel';
import { TabbedSidebar } from './components/TabbedSidebar';
import { getStoredPresets } from './components/GuideTab';
import { ParsedActivity } from './services/activityParserService';
import { PROMPT_INTRO, DEFAULT_ANSWERING_INSTRUCTIONS, PROMPT_CRITICAL, renderPrompt } from './services/promptUtils';
import { logger } from './services/logger';

// Pricing Constants for Gemini 2.5 Flash Native Audio (Live API)
// Model: gemini-2.5-flash-native-audio-preview-12-2025
// Reference: https://ai.google.dev/gemini-api/docs/pricing
// WARNING: This model is EXPENSIVE compared to standard Flash!

const TEXT_INPUT_PRICE = 0.50 / 1_000_000;           // $0.50 per 1M text tokens
const TEXT_OUTPUT_PRICE = 2.00 / 1_000_000;          // $2.00 per 1M text tokens
const AUDIO_VIDEO_INPUT_PRICE = 3.00 / 1_000_000;   // $3.00 per 1M audio/video tokens
const AUDIO_OUTPUT_PRICE = 12.00 / 1_000_000;       // $12.00 per 1M audio output tokens

// Token conversion rates (from https://ai.google.dev/gemini-api/docs/tokens)
const AUDIO_TOKENS_PER_SECOND = 32;    // 32 tokens per second of audio
const VIDEO_TOKENS_PER_SECOND = 263;   // 263 tokens per second of video

// Estimated hourly costs:
// - Audio-only: ~$0.37/hour
// - Audio + Video (1 FPS): ~$3.21/hour

// Detect Electron environment
const isElectron = !!window.electronAPI;

interface SuggestionItem {
  id: string;
  type: 'match' | 'ai';
  question: string;
  answer: string;
  timestamp: number;
}

// LocalStorage helpers for Q&A persistence
const SUGGESTIONS_STORAGE_KEY = 'interview_hud_suggestions';

const saveSuggestionsToStorage = (items: SuggestionItem[]) => {
  try {
    localStorage.setItem(SUGGESTIONS_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    logger.error('Failed to save suggestions:', err);
  }
};

const loadSuggestionsFromStorage = (): SuggestionItem[] => {
  try {
    const stored = localStorage.getItem(SUGGESTIONS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    logger.error('Failed to load suggestions:', err);
    return [];
  }
};

interface AudioSourceItem {
  id: string;
  name: string;
  type: 'monitor' | 'input';
}

export default function App() {
  const [hasKey, setHasKey] = useState(false);
  const [questions, setQuestions] = useState<InterviewQA[]>(INITIAL_QUESTIONS);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isEmbedding, setIsEmbedding] = useState(false);

  // Context State
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');

  // Model State
  const [selectedModel, setSelectedModel] = useState(LIVE_MODELS[0].id);

  // Audio Mode State
  const [audioMode, setAudioMode] = useState<'mixed' | 'system' | 'mic'>('mixed');

  // Device State
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');

  // Electron: PulseAudio sources
  const [systemAudioSources, setSystemAudioSources] = useState<AudioSourceItem[]>([]);
  const [selectedSystemSource, setSelectedSystemSource] = useState<string>('');

  // HUD State
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

  // Suggestion History (The "Constant Conversation")
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);

  // Media State
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [transparency, setTransparency] = useState(0.8);

  // Electron: Always on top toggle
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  // Transcript State
  const [transcriptHistory, setTranscriptHistory] = useState<TranscriptItem[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState<string>('');

  // Stats
  const [tokenStats, setTokenStats] = useState<TokenStats>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 });
  const [showSummary, setShowSummary] = useState(false);
  const [lastSessionStats, setLastSessionStats] = useState<TokenStats | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const [showAudioGuide, setShowAudioGuide] = useState(false);
  const [showContextModal, setShowContextModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentEdit, setCurrentEdit] = useState<Partial<InterviewQA>>({});

  // Interview mode preset
  const [activePresetId, setActivePresetId] = useState<string | null>(() => {
    const saved = localStorage.getItem('interview_hud_active_preset');
    return saved || null;
  });

  // Streaming answer state
  const [streamingAnswer, setStreamingAnswer] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingQuestion, setStreamingQuestion] = useState<string>('');

  // RAG context state
  const [retrievedChunks, setRetrievedChunks] = useState<EmbeddedChunk[]>([]);
  const [ragChunks, setRagChunks] = useState<KnowledgeItem[]>([]);  // Actual chunks sent to Gemini
  const [qaMatches, setQaMatches] = useState<EmbeddingMatch[]>([]);
  const [showRecordingPanel, setShowRecordingPanel] = useState(false);
  const [showLiveAnswerPanel, setShowLiveAnswerPanel] = useState(false);
  const [parsedActivities, setParsedActivities] = useState<ParsedActivity[]>([]);

  // Knowledge Base State (RAG items from uploaded documents)
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const knowledgeItemsRef = useRef<KnowledgeItem[]>([]);

  // Layout State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Suggestion refs for scrolling
  const suggestionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const embeddingServiceRef = useRef<EmbeddingService | null>(null);
  const knowledgeServiceRef = useRef<KnowledgeService | null>(null);
  const screenScannerRef = useRef<ScreenScannerService | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Keep track of streams to stop them later
  const streamsRef = useRef<{ system?: MediaStream, mic?: MediaStream }>({});

  // Screen scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<string | null>(null);

  // Track if user manually selected an audio source (don't auto-change it)
  const userSelectedSourceRef = useRef<boolean>(false);

  // Initial Key Check
  useEffect(() => {
    const checkKey = async () => {
      if (isElectron && window.electronAPI) {
        // In Electron, API key is stored in main process
        const key = await window.electronAPI.getApiKey();
        setHasKey(!!key);
      } else if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        setHasKey(true);
      }
    };
    checkKey();
  }, []);

  // Initialize embeddings on app load
  useEffect(() => {
    const initializeEmbeddings = async () => {
      if (!hasKey) return;

      // Get API key
      const apiKey = isElectron && window.electronAPI
        ? await window.electronAPI.getApiKey()
        : (process.env.API_KEY || '');

      if (!apiKey) return;

      // Create embedding service
      embeddingServiceRef.current = new EmbeddingService(apiKey);

      // Try to load cached embeddings
      const cacheLoaded = embeddingServiceRef.current.loadCachedEmbeddings(questions, company || undefined);

      if (cacheLoaded) {
        // Embeddings loaded from cache!
        setParsedActivities(embeddingServiceRef.current.getParsedActivities());
        logger.info('Embeddings loaded from cache');
      } else {
        // No cache or documents changed - need to compute embeddings
        logger.info('Cache miss - embeddings need to be computed on session start');
      }
    };

    initializeEmbeddings();
  }, [hasKey, questions, company]);

  // Load knowledge items from localStorage and initialize service
  useEffect(() => {
    const initializeKnowledge = async () => {
      if (!hasKey) return;

      // Get API key
      const apiKey = isElectron && window.electronAPI
        ? await window.electronAPI.getApiKey()
        : (process.env.API_KEY || '');

      if (!apiKey) return;

      // Create knowledge service
      knowledgeServiceRef.current = new KnowledgeService(apiKey);

      // Load cached knowledge items
      try {
        const saved = localStorage.getItem('interview_knowledge_items');
        if (saved) {
          const items = JSON.parse(saved) as KnowledgeItem[];
          setKnowledgeItems(items);
          knowledgeItemsRef.current = items;
          logger.info(`Loaded ${items.length} knowledge items from cache`);
        }
      } catch (err) {
        logger.error('Failed to load knowledge items:', err);
      }

      // Load cached Q&A suggestions
      const savedSuggestions = loadSuggestionsFromStorage();
      if (savedSuggestions.length > 0) {
        setSuggestions(savedSuggestions);
        logger.info(`Loaded ${savedSuggestions.length} Q&A suggestions from cache`);
      }
    };

    initializeKnowledge();
  }, [hasKey]);

  // Keep knowledge items ref in sync with state
  useEffect(() => {
    knowledgeItemsRef.current = knowledgeItems;
  }, [knowledgeItems]);

  // Save suggestions to localStorage when they change
  useEffect(() => {
    if (suggestions.length > 0) {
      saveSuggestionsToStorage(suggestions);
    }
  }, [suggestions]);

  // Save active preset to localStorage when it changes
  useEffect(() => {
    if (activePresetId) {
      localStorage.setItem('interview_hud_active_preset', activePresetId);
    } else {
      localStorage.removeItem('interview_hud_active_preset');
    }
  }, [activePresetId]);

  // Fetch Audio Devices (Mic)
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        setAudioInputDevices(inputs);
        if (inputs.length > 0 && !selectedMicId) {
          const defaultDevice = inputs.find(d => d.deviceId === 'default');
          setSelectedMicId(defaultDevice ? defaultDevice.deviceId : inputs[0].deviceId);
        }
      } catch (e) {
        console.warn("Error fetching devices", e);
      }
    };
    getDevices();

    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', getDevices);
  }, []);

  // Electron: Fetch audio sources with auto-refresh
  const refreshAudioSources = useCallback(async (autoSelect = false) => {
    if (!isElectron || !window.electronAPI) return;

    const sources = await window.electronAPI.getAudioSources();
    logger.info(`Audio sources refreshed: ${sources.length} sources found`);
    sources.forEach(s => logger.info(`  - ${s.name} (${s.id})`));
    setSystemAudioSources(sources);

    // Don't auto-select if user has manually chosen a source
    if (userSelectedSourceRef.current) {
      logger.info(`User has manually selected source, skipping auto-select`);
      // Verify the selected source still exists
      const stillExists = sources.some(s => s.id === selectedSystemSource);
      if (!stillExists && sources.length > 0) {
        logger.warn(`Previously selected source no longer available, keeping selection`);
      }
      return;
    }

    // Only auto-select on first load or if no source selected
    if (autoSelect || !selectedSystemSource) {
      const platform = window.electronAPI?.platform;
      if (platform === 'win32') {
        // Auto-select "Entire Screen" as default for reliability
        const entireScreen = sources.find(s => s.name.toLowerCase().includes('entire screen'));
        if (entireScreen) {
          logger.info(`Auto-selecting: ${entireScreen.name}`);
          setSelectedSystemSource(entireScreen.id);
        } else if (sources.length > 0) {
          logger.info(`Auto-selecting first source: ${sources[0].name}`);
          setSelectedSystemSource(sources[0].id);
        }
      } else {
        const monitor = sources.find(s => s.type === 'monitor');
        if (monitor) {
          logger.info(`Auto-selecting monitor: ${monitor.name}`);
          setSelectedSystemSource(monitor.id);
        }
      }
    }
  }, [selectedSystemSource]);

  // Initial fetch and auto-refresh every 5 seconds when disconnected
  useEffect(() => {
    if (!isElectron) return;

    // Initial fetch with auto-select
    refreshAudioSources(true);

    // Auto-refresh every 5 seconds when not connected
    const interval = setInterval(() => {
      if (connectionState === ConnectionState.DISCONNECTED) {
        refreshAudioSources(false);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [connectionState, refreshAudioSources]);

  // Disconnect handler - defined early because it's used in multiple places
  const handleDisconnect = useCallback(() => {
    logger.info('Disconnecting session...');
    if (geminiServiceRef.current) {
      geminiServiceRef.current.disconnect();
      geminiServiceRef.current = null;
    }

    // Stop Electron system audio capture
    if (isElectron && window.electronAPI) {
      window.electronAPI.stopSystemAudio();
    }

    if (streamsRef.current.system) streamsRef.current.system.getTracks().forEach(t => t.stop());
    if (streamsRef.current.mic) streamsRef.current.mic.getTracks().forEach(t => t.stop());
    streamsRef.current = {};
    setMediaStream(null);

    setConnectionState((prev) => {
      if (prev === ConnectionState.CONNECTED || prev === ConnectionState.CONNECTING) {
        setShowSummary(true);
      }
      return ConnectionState.DISCONNECTED;
    });

    setTokenStats(current => {
      setLastSessionStats(current);
      return current;
    });

    setActiveQuestionId(null);
    setIsStreaming(false);
    setStreamingAnswer('');
    setStreamingQuestion('');
    setLastError(null);
  }, []);

  // Connection timeout safety
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (connectionState === ConnectionState.CONNECTING || connectionState === ConnectionState.RECONNECTING) {
      timeoutId = setTimeout(() => {
        logger.error('Connection timed out after 15 seconds');
        alert('Connection timed out. Please check your internet connection and API key.');
        handleDisconnect();
      }, 15000); // 15 seconds timeout
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [connectionState, handleDisconnect]);

  // Note: Transparency only affects background elements (header, sidebar)
  // The answer panel stays fully opaque for readability

  // Electron: Update always-on-top state
  useEffect(() => {
    if (isElectron && window.electronAPI) {
      window.electronAPI.setAlwaysOnTop(alwaysOnTop);
    }
  }, [alwaysOnTop]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptHistory, currentTranscript]);

  // Scroll to a specific suggestion by index
  const scrollToSuggestion = (index: number) => {
    suggestionRefs.current[index]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };

  // Clear all Q&A history
  const clearHistory = () => {
    setSuggestions([]);
    localStorage.removeItem(SUGGESTIONS_STORAGE_KEY);
    logger.info('Cleared Q&A history');
  };

  // Start session (works for both Electron and Web)
  const startSession = async () => {
    setShowAudioGuide(false);

    try {
      let micStream: MediaStream | undefined;
      let systemStream: MediaStream | undefined;

      // Get mic stream (works in both environments)
      if (audioMode !== 'system') {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true
          });
        } catch (err) {
          logger.warn("Could not access microphone", err);
        }
      }

      // Electron: Start system audio capture
      if (isElectron && window.electronAPI && audioMode !== 'mic' && selectedSystemSource) {
        const platform = window.electronAPI.platform;
        logger.info(`Starting system audio capture on ${platform}, source: ${selectedSystemSource}`);

        if (platform === 'win32') {
          // Windows: Must capture video to get audio (they're tied together in desktop capture)
          // We capture both but only send audio to Gemini
          logger.info('Attempting Windows system audio capture with source:', selectedSystemSource);

          // Try multiple approaches to capture audio
          const captureAttempts = [
            // Attempt 1: Standard approach with minimal video
            async () => {
              const stream = await (navigator.mediaDevices as any).getUserMedia({
                audio: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: selectedSystemSource
                  }
                },
                video: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: selectedSystemSource,
                    maxWidth: 1,
                    maxHeight: 1
                  }
                }
              });
              return stream;
            },
            // Attempt 2: Try with larger video dimensions (some sources need this)
            async () => {
              const stream = await (navigator.mediaDevices as any).getUserMedia({
                audio: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: selectedSystemSource
                  }
                },
                video: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: selectedSystemSource,
                    maxWidth: 320,
                    maxHeight: 240
                  }
                }
              });
              return stream;
            },
            // Attempt 3: Use getDisplayMedia as fallback (might prompt user)
            async () => {
              logger.info('Trying getDisplayMedia as fallback...');
              const stream = await navigator.mediaDevices.getDisplayMedia({
                audio: true,
                video: { width: 1, height: 1 }
              });
              return stream;
            }
          ];

          let fullStream: MediaStream | null = null;
          let lastError: any = null;

          for (let i = 0; i < captureAttempts.length; i++) {
            try {
              logger.info(`Audio capture attempt ${i + 1}/${captureAttempts.length}`);
              fullStream = await captureAttempts[i]();
              if (fullStream) {
                logger.info(`Capture attempt ${i + 1} succeeded`);
                break;
              }
            } catch (err: any) {
              logger.warn(`Capture attempt ${i + 1} failed:`, err?.message || err);
              lastError = err;
              // Continue to next attempt
            }
          }

          if (fullStream) {
            const audioTracks = fullStream.getAudioTracks();
            const videoTracks = fullStream.getVideoTracks();
            logger.info(`Captured tracks - Audio: ${audioTracks.length}, Video: ${videoTracks.length}`);

            // Stop video tracks immediately - we don't need them
            videoTracks.forEach(track => track.stop());

            if (audioTracks.length > 0) {
              systemStream = new MediaStream(audioTracks);
              logger.info('Windows system audio capture started successfully');
            } else {
              logger.error('No audio tracks captured from source!');
              alert('No audio was captured from this source. Please:\n\n1. START PLAYING AUDIO first (YouTube, music, etc.)\n2. Then click Start while audio is playing\n3. Try selecting a different source\n4. For best results, use "Entire Screen"');
              return; // Don't continue with connection
            }
          } else {
            logger.error('All capture attempts failed');
            logger.error('Last error:', lastError?.name, lastError?.message);
            alert(`Failed to capture system audio after multiple attempts.\n\nError: ${lastError?.message || 'Unknown error'}\n\nTry:\n1. Make sure audio is ACTIVELY PLAYING\n2. Select "Entire Screen" as the source\n3. Close and reopen the app\n4. Check Windows privacy settings`);
            return; // Don't continue with connection
          }
        } else {
          // Linux: Use IPC to start PulseAudio capture
          await window.electronAPI.startSystemAudio(selectedSystemSource);
        }
      }

      // Validate we have at least one audio stream before connecting
      if (!micStream && !systemStream) {
        logger.error('No valid audio streams available - cannot start session');
        alert('No audio stream available. Please check your audio source selection and try again.');
        return;
      }

      logger.info(`Starting Gemini session with streams - Mic: ${!!micStream}, System: ${!!systemStream}`);
      streamsRef.current = { mic: micStream, system: systemStream };
      setMediaStream(micStream || systemStream || null);

      startGeminiSession(streamsRef.current);

    } catch (err: any) {
      logger.error("Error starting session:", err);
      alert(err.message || "Failed to start session.");
    }
  };

  const startMicCaptureOnly = async () => {
    try {
      logger.info('Starting mic-only capture');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true
      });
      streamsRef.current = { mic: stream };
      setMediaStream(stream);
      startGeminiSession(streamsRef.current, true);
    } catch (err: any) {
      logger.error("Error accessing mic:", err);
      alert("Failed to access microphone. Please check permissions.");
    }
  };

  const startGeminiSession = async (streams: { system?: MediaStream, mic?: MediaStream }, forceMicOnly = false, isReconnect = false) => {
    setConnectionState(isReconnect ? ConnectionState.RECONNECTING : ConnectionState.CONNECTING);

    // Only clear state on fresh connection, not on reconnect
    // Note: suggestions are NOT cleared - they persist across sessions for Q&A history recall
    if (!isReconnect) {
      setTranscriptHistory([]);
      setCurrentTranscript('');
      setActiveQuestionId(null);
      setTokenStats({ inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 });
      setShowSummary(false);
    }

    const apiKey = isElectron && window.electronAPI
      ? await window.electronAPI.getApiKey()
      : (process.env.API_KEY || '');

    geminiServiceRef.current = new GeminiLiveService(apiKey);

    // Build system instruction with preset override capability
    let answeringInstructions = DEFAULT_ANSWERING_INSTRUCTIONS;

    // If preset is active, REPLACE default answering instructions (not append)
    if (activePresetId) {
      const presets = getStoredPresets();
      const activePreset = presets.find(p => p.id === activePresetId);
      if (activePreset) {
        answeringInstructions = `

WHEN ANSWERING (${activePreset.title}):
${activePreset.instructions}`;
        logger.info(`Using preset answering instructions: ${activePreset.title}`);
      }
    }

    const systemInstruction = renderPrompt(PROMPT_INTRO, { company: company || 'General' })
      + answeringInstructions
      + PROMPT_CRITICAL;

    // Initialize embedding service for semantic matching
    if (!embeddingServiceRef.current) {
      embeddingServiceRef.current = new EmbeddingService(apiKey);
    }

    // Initialize comprehensive embeddings including CV, activities, and artifacts
    // Try to load from cache first, only compute if needed
    const stats = embeddingServiceRef.current.getTotalEmbeddings();
    const hasEmbeddings = stats.qa > 0 || stats.chunks > 0;

    if (!hasEmbeddings) {
      // No embeddings loaded - need to compute them
      try {
        setIsEmbedding(true);
        logger.info('Computing embeddings for the first time...');
        await embeddingServiceRef.current.initializeAllEmbeddings(questions, company || undefined);
        // Update parsed activities state after initialization
        if (embeddingServiceRef.current) {
          setParsedActivities(embeddingServiceRef.current.getParsedActivities());
        }
        logger.info('Embeddings initialized and saved to cache');
      } catch (err) {
        logger.warn('Failed to initialize embeddings:', err);
        // Continue anyway - embeddings are optional
      } finally {
        setIsEmbedding(false);
      }
    } else {
      logger.info(`Using cached embeddings: ${stats.qa} Q&A, ${stats.chunks} chunks`);
    }

    logger.info(`Starting Gemini connection with model: ${selectedModel}`);
    logger.info("System Prompt length:", systemInstruction.length);

    const streamsToConnect = { ...streams };
    if (!forceMicOnly) {
      if (audioMode === 'system') streamsToConnect.mic = undefined;
      else if (audioMode === 'mic') streamsToConnect.system = undefined;
    }

    // In Electron, we pass systemAudioSource ID for the service to handle
    const electronConfig = isElectron ? { systemAudioSource: selectedSystemSource } : undefined;

    // Initialize screen scanner service
    if (!screenScannerRef.current) {
      screenScannerRef.current = new ScreenScannerService(apiKey);
    }

    await geminiServiceRef.current.connect(streamsToConnect, selectedModel, systemInstruction, {
      onOpen: () => setConnectionState(ConnectionState.CONNECTED),
      onMatch: (id) => {
        setQuestions(prevQuestions => {
          const match = prevQuestions.find(q => q.id === id);
          if (match) {
            setSuggestions(prev => [...prev, {
              id: Date.now().toString(),
              type: 'match',
              question: match.question,
              answer: match.answer,
              timestamp: Date.now()
            }]);
            setActiveQuestionId(id);
          }
          return prevQuestions;
        });
      },
      onAiAnswer: (answer, question) => {
        // Finalize streaming answer into suggestions
        setSuggestions(prev => [...prev, {
          id: Date.now().toString(),
          type: 'ai',
          question: question,
          answer: answer,
          timestamp: Date.now()
        }]);
        setActiveQuestionId(null);
        setIsStreaming(false);
        setStreamingAnswer('');
        setStreamingQuestion('');
      },
      onTextChunk: (chunk) => {
        setStreamingAnswer(prev => prev + chunk);
      },
      onStreamingStart: async (question) => {
        setIsStreaming(true);
        setStreamingAnswer('');
        setStreamingQuestion(question);
        setShowLiveAnswerPanel(true);

        // Retrieve relevant context chunks for this question (for UI display)
        if (embeddingServiceRef.current) {
          try {
            const { qaMatches: matches, contextChunks } = await embeddingServiceRef.current.findComprehensiveMatches(question);
            setQaMatches(matches);
            setRetrievedChunks(contextChunks);
          } catch (err) {
            console.warn('Failed to retrieve context:', err);
          }
        }
      },
      onStreamingEnd: () => {
        // Streaming end is handled in onAiAnswer
      },
      // RAG: Retrieve relevant context from knowledge base
      onRetrieveContext: async (question: string): Promise<string> => {
        const currentItems = knowledgeItemsRef.current;

        if (!knowledgeServiceRef.current || currentItems.length === 0) {
          logger.warn('[RAG] No knowledge items available');
          return 'NOTICE: No documents have been uploaded to the knowledge base. Answer based on general knowledge.';
        }

        try {
          // Find similar items using vector search
          const relevantItems = await knowledgeServiceRef.current.findSimilar(question, currentItems, 5);

          // Store the actual RAG chunks for UI display
          setRagChunks(relevantItems);

          if (relevantItems.length === 0) {
            return 'No relevant context found in knowledge base.';
          }

          // Format context for Gemini
          let context = '=== RELEVANT CANDIDATE CONTEXT ===\n\n';
          relevantItems.forEach((item, i) => {
            context += `[${item.metadata.type.toUpperCase()}: ${item.title}]\n${item.content}\n`;
            if (item.metadata.skills && item.metadata.skills.length > 0) {
              context += `Skills: ${item.metadata.skills.join(', ')}\n`;
            }
            context += '\n---\n\n';
          });
          context += '=== END CONTEXT ===\n\nUse the above context to personalize your answer based on the candidate\'s actual experiences.';

          logger.info(`[RAG] Retrieved ${relevantItems.length} items for: "${question.slice(0, 50)}..."`);
          return context;
        } catch (err) {
          logger.error('[RAG] Retrieval error:', err);
          return '';
        }
      },
      onTranscriptUpdate: (text) => setCurrentTranscript(text),
      onTranscriptCommit: (text, speaker) => {
        setTranscriptHistory(prev => [...prev, {
          id: Date.now().toString(),
          text: text,
          sender: speaker === 'ai' ? 'model' : 'user',
          speaker: speaker,
          timestamp: Date.now()
        }]);
        setCurrentTranscript('');
      },
      onTokenUpdate: (tokenData) => {
        // Calculate cost with correct modality pricing
        const cost =
          (tokenData.textInput * TEXT_INPUT_PRICE) +
          (tokenData.audioVideoInput * AUDIO_VIDEO_INPUT_PRICE) +
          (tokenData.textOutput * TEXT_OUTPUT_PRICE) +
          (tokenData.audioOutput * AUDIO_OUTPUT_PRICE);

        console.log(`[App] Token update:`, {
          textInput: tokenData.textInput,
          audioVideoInput: tokenData.audioVideoInput,
          textOutput: tokenData.textOutput,
          audioOutput: tokenData.audioOutput,
          totalInput: tokenData.totalInput,
          totalOutput: tokenData.totalOutput,
          cost: `$${cost.toFixed(6)}`
        });

        setTokenStats({
          inputTokens: tokenData.totalInput,
          outputTokens: tokenData.totalOutput,
          totalTokens: tokenData.totalInput + tokenData.totalOutput,
          estimatedCost: cost
        });
      },
      onError: (e) => {
        console.error('Gemini connection error:', e);
        setLastError(e.message || "Unknown error");
        // Don't clear suggestions - keep previous answers visible
        // Attempt auto-reconnect after 2 seconds
        setConnectionState(ConnectionState.RECONNECTING);
        setTimeout(() => {
          if (streamsRef.current.mic || streamsRef.current.system) {
            console.log('Auto-reconnecting after error...');
            startGeminiSession(streamsRef.current, false, true);
          } else {
            setConnectionState(ConnectionState.ERROR);
            alert(`Connection Error: ${e.message}\n\nPlease restart the session.`);
          }
        }, 2000);
      },

      onClose: () => {
        logger.info('Gemini session closed by server');
        // Don't clear suggestions - keep previous answers visible
        // Attempt auto-reconnect after 2 seconds
        setConnectionState(ConnectionState.RECONNECTING);
        setTimeout(() => {
          if (streamsRef.current.mic || streamsRef.current.system) {
            logger.info('Auto-reconnecting after session close...');
            startGeminiSession(streamsRef.current, false, true);
          } else {
            logger.warn('Cannot reconnect - no audio streams, disconnecting');
            handleDisconnect();
          }
        }, 2000);
      }
    }, electronConfig);
  };

  const refreshEmbeddings = useCallback(async () => {
    if (!embeddingServiceRef.current || connectionState !== ConnectionState.DISCONNECTED) return;

    const apiKey = isElectron && window.electronAPI
      ? await window.electronAPI.getApiKey()
      : (process.env.API_KEY || '');

    if (!apiKey) return;

    try {
      setIsEmbedding(true);
      // Clear cache
      embeddingServiceRef.current.clearCachedEmbeddings();
      embeddingServiceRef.current.clearCache();

      // Re-initialize
      logger.info('Refreshing embeddings...');
      await embeddingServiceRef.current.initializeAllEmbeddings(questions, company || undefined);
      setParsedActivities(embeddingServiceRef.current.getParsedActivities());
      logger.info('Embeddings refreshed successfully');
    } catch (err) {
      logger.error('Failed to refresh embeddings:', err);
      alert('Failed to refresh embeddings. Check console for details.');
    } finally {
      setIsEmbedding(false);
    }
  }, [questions, company, connectionState, isElectron]);

  const handleSaveQuestion = () => {
    if (currentEdit.id) {
      setQuestions(prev => prev.map(q => q.id === currentEdit.id ? { ...q, ...currentEdit } as InterviewQA : q));
    } else {
      const newQ: InterviewQA = {
        id: Date.now().toString(),
        topic: currentEdit.topic || 'New Topic',
        question: currentEdit.question || '',
        answer: currentEdit.answer || ''
      };
      setQuestions(prev => [...prev, newQ]);
    }
    setIsEditing(false);
    setCurrentEdit({});
  };

  // Screen scan handler - captures screen and detects questions
  const handleScreenScan = async () => {
    if (!screenScannerRef.current || !geminiServiceRef.current) {
      logger.warn('Screen scanner or Gemini service not initialized');
      return;
    }

    logger.info('Starting screen scan for questions...');
    setIsScanning(true);
    setLastScanResult(null);

    try {
      const result = await screenScannerRef.current.scanScreen();

      if (result.hasQuestion && result.question) {
        setLastScanResult(result.question);
        logger.info('Question detected from screen:', result.question);

        // Inject the detected question into the live session
        await geminiServiceRef.current.injectText(
          `[SCREEN CAPTURE] The interviewer is showing this question on screen: "${result.question}"`
        );
      } else {
        setLastScanResult('No question detected');
        logger.info('No question detected on screen');
      }
    } catch (err) {
      logger.error('Screen scan failed:', err);
      setLastScanResult('Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  if (!hasKey) {
    return <ApiKeyModal onComplete={() => setHasKey(true)} />;
  }

  return (
    <div
      className="flex flex-col h-full w-full text-white relative overflow-hidden"
      style={{
        // Transparent background for Electron, dark for web
        backgroundColor: isElectron ? 'transparent' : '#111827'
      }}
    >
      {/* Header - Draggable in Electron */}
      <header
        className="flex flex-col gap-2 p-4 border-b border-gray-700/50 backdrop-blur-md z-20 shrink-0"
        style={{
          WebkitAppRegion: isElectron ? 'drag' : 'no-drag',
          backgroundColor: isElectron ? `rgba(17, 24, 39, ${transparency})` : 'rgba(17, 24, 39, 0.8)'
        } as React.CSSProperties}
      >
        <div className="flex items-center justify-between" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="flex items-center gap-3">

            {/* Sidebar Toggle Button */}
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                {isSidebarOpen ? <path d="M13 12h4" /> : <path d="M11 12h4" />}
              </svg>
            </button>

            <div className={`h-3 w-3 rounded-full ${connectionState === ConnectionState.RECONNECTING ? 'animate-pulse' : ''}`}
              style={{
                backgroundColor: connectionState === ConnectionState.CONNECTED ? '#10b981' :
                                connectionState === ConnectionState.CONNECTING ? '#f59e0b' :
                                connectionState === ConnectionState.RECONNECTING ? '#f59e0b' : '#ef4444',
                boxShadow: connectionState === ConnectionState.CONNECTED ? '0 0 10px #10b981' :
                          connectionState === ConnectionState.RECONNECTING ? '0 0 10px #f59e0b' : 'none'
              }}
            />
            <h1 className="font-bold text-lg tracking-tight drop-shadow-md">
              INTERVIEW<span className="text-blue-500">HUD</span>
              {isElectron && <span className="text-xs text-gray-500 ml-2">(Desktop)</span>}
            </h1>
            {connectionState === ConnectionState.CONNECTED && (
              <div className="ml-4 text-xs font-mono text-gray-400 bg-gray-900/50 px-2 py-1 rounded border border-gray-700">
                ${tokenStats.estimatedCost.toFixed(6)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Scan Screen Button - Only show when connected */}
            {connectionState === ConnectionState.CONNECTED && (
              <button
                onClick={handleScreenScan}
                disabled={isScanning}
                className={`px-3 py-1 text-xs rounded transition-colors flex items-center gap-1.5 ${
                  isScanning
                    ? 'bg-yellow-600 text-white'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                }`}
                title="Scan screen for interview questions"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                {isScanning ? 'Scanning...' : 'Scan Screen'}
              </button>
            )}

            {/* Live Answer Panel Toggle */}
            <button
              onClick={() => setShowLiveAnswerPanel(!showLiveAnswerPanel)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                showLiveAnswerPanel
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
              title="Toggle Live Answer Panel with RAG context"
            >
              {showLiveAnswerPanel ? 'RAG View' : 'Classic View'}
            </button>

            {/* Electron: Always on Top Toggle */}
            {isElectron && (
              <button
                onClick={() => setAlwaysOnTop(!alwaysOnTop)}
                className={`px-3 py-1 text-xs rounded transition-colors ${alwaysOnTop ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                title="Toggle always on top"
              >
                {alwaysOnTop ? 'Pinned' : 'Unpinned'}
              </button>
            )}

            {connectionState === ConnectionState.CONNECTED && (
              <Visualizer stream={mediaStream} active={true} />
            )}

            {/* Background Transparency Slider */}
            <div className="flex items-center gap-2 bg-gray-900/60 rounded-full px-3 py-1 border border-gray-700" title="Adjust Background Opacity">
              <span className="text-xs text-gray-400">BG</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={transparency}
                onChange={(e) => setTransparency(parseFloat(e.target.value))}
                className="w-20 accent-blue-500 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {isEmbedding ? (
              <div className="flex items-center gap-2 px-4 py-2 bg-purple-600/30 border border-purple-500/50 rounded text-sm backdrop-blur-sm">
                <div className="h-3 w-3 rounded-full bg-purple-400 animate-pulse" />
                <span className="text-purple-200">Memorizing your background... just a moment!</span>
              </div>
            ) : connectionState === ConnectionState.DISCONNECTED ? (
              <div className="flex gap-2">
                <button
                  onClick={startMicCaptureOnly}
                  className="px-4 py-2 bg-gray-700/80 hover:bg-gray-600 rounded text-sm font-medium transition-colors backdrop-blur-sm"
                >
                  Mic Only
                </button>
                <button
                  onClick={isElectron ? startSession : () => setShowAudioGuide(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors shadow-lg shadow-blue-500/20"
                >
                  Start Session
                </button>
              </div>
            ) : (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 bg-red-600/90 hover:bg-red-500 rounded text-sm font-medium transition-colors border border-red-500/50 backdrop-blur-sm"
              >
                End Session
              </button>
            )}
          </div>
        </div>

        <div className="flex md:hidden gap-2 w-full mt-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <input
            type="text"
            placeholder="Medical School (e.g. UTSW)"
            className={`bg-gray-800 border border-gray-600 rounded px-3 py-1 text-sm focus:border-blue-500 outline-none w-1/2 ${connectionState !== ConnectionState.DISCONNECTED ? 'opacity-60' : ''}`}
            value={company}
            onChange={e => setCompany(e.target.value)}
            disabled={connectionState !== ConnectionState.DISCONNECTED}
          />
          <input
            type="text"
            placeholder="Interview Type (e.g. MMI)"
            className={`bg-gray-800 border border-gray-600 rounded px-3 py-1 text-sm focus:border-blue-500 outline-none w-1/2 ${connectionState !== ConnectionState.DISCONNECTED ? 'opacity-60' : ''}`}
            value={position}
            onChange={e => setPosition(e.target.value)}
            disabled={connectionState !== ConnectionState.DISCONNECTED}
          />
        </div>
      </header>

      {/* Content Columns */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Left: Tabbed Sidebar (Toggleable) */}
        <div
          className={`
            border-r border-gray-700/30 flex flex-col backdrop-blur-sm z-30 transition-all duration-300 ease-in-out
            ${isSidebarOpen ? 'w-1/3 min-w-[320px] max-w-[400px] opacity-100 translate-x-0' : 'w-0 min-w-0 max-w-0 opacity-0 -translate-x-full overflow-hidden border-none'}
          `}
          style={{ backgroundColor: isElectron ? `rgba(17, 24, 39, ${transparency})` : 'rgba(17, 24, 39, 0.8)' }}
        >
          <TabbedSidebar
            questions={questions}
            activeQuestionId={activeQuestionId}
            parsedActivities={parsedActivities}
            knowledgeItems={knowledgeItems}
            transcriptHistory={transcriptHistory}
            currentTranscript={currentTranscript}
            selectedModel={selectedModel}
            audioMode={audioMode}
            selectedMicId={selectedMicId}
            selectedSystemSource={selectedSystemSource}
            audioInputDevices={audioInputDevices}
            systemAudioSources={systemAudioSources}
            connectionState={connectionState}
            streams={streamsRef.current}
            currentSchool={company}
            isEmbedding={isEmbedding}
            embeddingStats={
              embeddingServiceRef.current
                ? embeddingServiceRef.current.getTotalEmbeddings()
                : undefined
            }
            onSelectModel={setSelectedModel}
            onSelectAudioMode={setAudioMode}
            onSelectMic={setSelectedMicId}
            onSelectSystemSource={(id) => {
              logger.info(`User manually selected audio source: ${id}`);
              userSelectedSourceRef.current = true;
              setSelectedSystemSource(id);
            }}
            onRefreshSources={() => refreshAudioSources(false)}
            onSelectQuestion={(id) => setActiveQuestionId(id)}
            onEditQuestion={(q) => { setCurrentEdit(q); setIsEditing(true); }}
            onDeleteQuestion={(id) => setQuestions(prev => prev.filter(q => q.id !== id))}
            onAddQuestion={() => { setCurrentEdit({}); setIsEditing(true); }}
            onOpenContextModal={() => setShowContextModal(true)}
            onSchoolChange={setCompany}
            onRefreshEmbeddings={refreshEmbeddings}
            activePresetId={activePresetId}
            onTogglePreset={(id) => setActivePresetId(prev => prev === id ? null : id)}
            liveModels={LIVE_MODELS}
            isElectron={isElectron}
            platform={window.electronAPI?.platform}
          />
          <div ref={transcriptEndRef} />
        </div>

        {/* Right: Main content area - Live Answer Panel or status */}
        <div className="flex-1 p-4 flex flex-col relative overflow-hidden">
          {/* Live Answer Panel Mode - Show when connected and panel enabled */}
          {showLiveAnswerPanel && connectionState === ConnectionState.CONNECTED ? (
            <LiveAnswerPanel
              question={streamingQuestion}
              streamingAnswer={streamingAnswer}
              isStreaming={isStreaming}
              qaMatches={qaMatches}
              contextChunks={retrievedChunks}
              ragChunks={ragChunks}
              presetAnswer={
                qaMatches.length > 0
                  ? questions.find(q => q.id === qaMatches[0].id)?.answer
                  : undefined
              }
              suggestions={suggestions}
              onScrollToSuggestion={scrollToSuggestion}
              onClearHistory={clearHistory}
              suggestionRefs={suggestionRefs}
            />
          ) : (
            /* Status indicators when not showing Live Answer Panel */
            <div className="flex-1 flex flex-col justify-center items-center bg-gray-900/20 backdrop-blur-sm m-4 rounded-3xl border border-white/5">
              {suggestions.length === 0 && connectionState === ConnectionState.CONNECTED && (
                <div className="flex flex-col items-center justify-center text-white/20 select-none pointer-events-none">
                  <div className="text-4xl font-black tracking-tighter uppercase mb-2">Listening...</div>
                  <div className="text-sm tracking-widest text-white/10">Waiting for Question</div>
                  {embeddingServiceRef.current && (
                    <div className="text-xs text-white/5 mt-4">
                      {embeddingServiceRef.current.getTotalEmbeddings().qa} Q&A + {embeddingServiceRef.current.getTotalEmbeddings().chunks} context chunks ready
                    </div>
                  )}
                </div>
              )}
              {suggestions.length === 0 && connectionState === ConnectionState.DISCONNECTED && (
                <div className="flex flex-col items-center justify-center text-white/10 select-none pointer-events-none">
                  <div className="text-2xl font-bold tracking-tight mb-2">Ready</div>
                  <div className="text-sm text-white/5">Click "Start Session" to begin</div>
                </div>
              )}
              {connectionState === ConnectionState.RECONNECTING && (
                <div className="flex flex-col items-center justify-center text-yellow-500/60 select-none pointer-events-none animate-pulse text-center p-4">
                  <div className="text-3xl font-black tracking-tighter uppercase mb-2">Reconnecting...</div>
                  <div className="text-sm tracking-widest text-yellow-500/40 mb-2">Session will resume shortly</div>
                  {lastError && (
                    <div className="text-xs text-red-400 font-mono mt-2 max-w-xs break-words bg-black/20 p-2 rounded border border-red-500/20">
                      Error: {lastError}
                    </div>
                  )}
                </div>
              )}
              {connectionState === ConnectionState.CONNECTING && suggestions.length === 0 && (
                <div className="flex flex-col items-center justify-center text-blue-400 select-none pointer-events-none animate-pulse">
                  <div className="text-3xl font-black tracking-tighter uppercase mb-2">Connecting...</div>
                  <div className="text-sm tracking-widest text-blue-500/60">Please wait</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Session Summary Modal */}
      {showSummary && lastSessionStats && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in">
          <div className="bg-gray-800 border border-gray-600 rounded-xl p-8 max-w-sm w-full shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>
            <h2 className="text-2xl font-bold text-white mb-6 tracking-tight">Session Complete</h2>
            <div className="space-y-4 mb-8">
              <div className="flex justify-between items-center pb-2 border-b border-gray-700">
                <span className="text-gray-400">Input Tokens</span>
                <span className="font-mono text-blue-400">{lastSessionStats.inputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-gray-700">
                <span className="text-gray-400">Output Tokens</span>
                <span className="font-mono text-purple-400">{lastSessionStats.outputTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-gray-200 font-bold">Estimated Cost</span>
                <span className="font-mono text-green-400 text-xl font-bold">
                  ${lastSessionStats.estimatedCost.toFixed(5)}
                </span>
              </div>
            </div>
            <button onClick={() => setShowSummary(false)} className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors">Close</button>
          </div>
        </div>
      )}

      {/* Web-only: Audio Guide Modal */}
      {!isElectron && showAudioGuide && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-gray-800 border border-gray-600 rounded-xl p-8 max-w-xl w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">Capturing System Audio</h2>
            <div className="space-y-4 mb-8">
              <p className="text-gray-300">
                For the web version, you need to share your screen to capture system audio.
              </p>
              <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded text-sm text-blue-200">
                <p className="font-bold mb-2">For true transparency, use the Desktop app!</p>
                <p className="text-blue-300/80">The Electron version provides a truly transparent window that floats over your Zoom/Teams call.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowAudioGuide(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
              <button onClick={startMicCaptureOnly} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium shadow-lg">Start with Mic Only</button>
            </div>
          </div>
        </div>
      )}

      {/* Context Modal */}
      <ContextModal
        isOpen={showContextModal}
        onClose={() => setShowContextModal(false)}
        knowledgeItems={knowledgeItems}
        onItemsUpdate={setKnowledgeItems}
      />

      {/* Edit Modal */}
      {isEditing && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-bold mb-4">Edit Question</h3>
            <div className="space-y-4">
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white outline-none"
                value={currentEdit.topic || ''}
                onChange={e => setCurrentEdit(prev => ({...prev, topic: e.target.value}))}
                placeholder="Topic"
              />
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white outline-none"
                value={currentEdit.question || ''}
                onChange={e => setCurrentEdit(prev => ({...prev, question: e.target.value}))}
                placeholder="Question"
              />
              <textarea
                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white h-32 outline-none resize-none"
                value={currentEdit.answer || ''}
                onChange={e => setCurrentEdit(prev => ({...prev, answer: e.target.value}))}
                placeholder="Answer"
              />
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleSaveQuestion} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
