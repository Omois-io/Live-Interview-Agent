
export interface InterviewQA {
  id: string;
  topic: string;
  question: string;
  answer: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  metadata: {
    type: 'experience' | 'activity' | 'education' | 'qa' | 'other';
    date?: string;
    skills?: string[];
  };
  embedding?: number[];
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

export interface AudioSource {
  stream: MediaStream;
  type: 'microphone' | 'system';
}

export interface TranscriptItem {
  id: string;
  text: string;
  sender: 'user' | 'model';
  speaker: 'interviewer' | 'you' | 'ai';
  timestamp: number;
}

export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface InstructionPreset {
  id: string;
  title: string;
  instructions: string;
  createdAt: number;
}

export interface SuggestionItem {
  id: string;
  type: 'match' | 'ai';
  question: string;
  liveAnswer: string;       // Fast streaming answer
  thoroughAnswer?: string;  // Thorough answer (Gemini 3 Pro / Claude Opus)
  timestamp: number;
}
