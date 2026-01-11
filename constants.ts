import { InterviewQA } from "./types";
import questionsData from "./questions.json";

// Map the JSON format (category) to our app format (topic)
export const INITIAL_QUESTIONS: InterviewQA[] = questionsData.map((q: any) => ({
  id: q.id,
  topic: q.category,
  question: q.question,
  answer: q.answer
}));

export const LIVE_MODELS = [
  { id: 'gemini-2.5-flash-native-audio-preview-12-2025', name: 'Gemini 2.5 Flash (Audio Preview)' },
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp' }
];

export const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';

// Embedding and parsing model configuration
export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const ACTIVITY_PARSER_MODEL = 'gemini-3-flash-preview';