import { KnowledgeItem } from '../types';
import { logger } from './logger';

export type ThoroughModel = 'gemini-3-pro-preview' | 'claude-opus-4-5-20251101';

export const THOROUGH_MODELS: { id: ThoroughModel; name: string }[] = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro' },
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5' },
];

interface ThoroughAnswerOptions {
  question: string;
  ragChunks: KnowledgeItem[];
  presetInstructions?: string;
  model: ThoroughModel;
  apiKey: string;
  claudeApiKey?: string;
  onChunk?: (chunk: string) => void;
}

export class ThoroughAnswerService {
  /**
   * Generate a thorough answer using the selected model
   */
  async generateAnswer(options: ThoroughAnswerOptions): Promise<string> {
    const { question, ragChunks, presetInstructions, model, apiKey, claudeApiKey, onChunk } = options;

    logger.info(`[ThoroughAnswer] Generating with ${model} for: "${question.slice(0, 50)}..."`);

    // Build context from RAG chunks
    let context = '';
    if (ragChunks.length > 0) {
      context = '\n\n=== RELEVANT CONTEXT FROM CANDIDATE\'S BACKGROUND ===\n\n';
      ragChunks.forEach((chunk, i) => {
        context += `[${i + 1}. ${chunk.metadata.type.toUpperCase()}: ${chunk.title}]\n`;
        context += `${chunk.content}\n`;
        if (chunk.metadata.skills?.length) {
          context += `Skills: ${chunk.metadata.skills.join(', ')}\n`;
        }
        context += '\n---\n\n';
      });
    }

    // Build the prompt
    const systemPrompt = `You are an expert interview coach helping a medical school candidate prepare answers.

${presetInstructions || 'Provide a well-structured, detailed answer that demonstrates the candidate\'s experiences and qualities.'}

IMPORTANT GUIDELINES:
- Use the candidate's actual experiences from the context provided
- Be specific with examples and outcomes
- Structure the answer clearly (situation, action, result when applicable)
- Keep the tone professional but personable
- If the context doesn't have relevant information, provide general guidance`;

    const userPrompt = `INTERVIEW QUESTION: ${question}
${context}
Please generate a thorough, well-structured answer to this interview question using the candidate's background context above.`;

    if (model.startsWith('gemini')) {
      return this.callGemini(apiKey, systemPrompt, userPrompt, onChunk);
    } else if (model.startsWith('claude')) {
      const key = claudeApiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new Error('Claude API key not configured');
      }
      return this.callClaude(key, systemPrompt, userPrompt, onChunk);
    }

    throw new Error(`Unknown model: ${model}`);
  }

  private async callGemini(
    apiKey: string,
    systemPrompt: string,
    userPrompt: string,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 1,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('[ThoroughAnswer] Gemini error:', error);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    logger.info(`[ThoroughAnswer] Gemini generated ${text.length} chars`);
    return text;
  }

  private async callClaude(
    apiKey: string,
    systemPrompt: string,
    userPrompt: string,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 4096,
        temperature: 1,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('[ThoroughAnswer] Claude error:', error);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text || '';
    logger.info(`[ThoroughAnswer] Claude generated ${text.length} chars`);
    return text;
  }
}

// Singleton instance
export const thoroughAnswerService = new ThoroughAnswerService();
