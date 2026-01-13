
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
    type: 'experience' | 'activity' | 'education' | 'other';
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
