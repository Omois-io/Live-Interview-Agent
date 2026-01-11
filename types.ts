
export interface InterviewQA {
  id: string;
  topic: string;
  question: string;
  answer: string;
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
  speaker: 'interviewer' | 'you';
  timestamp: number;
}

export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}
