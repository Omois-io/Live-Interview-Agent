import { GoogleGenAI, Type, Schema } from "@google/genai";
import { KnowledgeItem } from "../types";
import { logger } from "./logger";
import { EMBEDDING_MODEL, ACTIVITY_PARSER_MODEL } from "../constants";

// Schema for structured document parsing (CV/Activities OR Q&A)
const DOCUMENT_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "For CV/Activities: title of job/activity/degree. For Q&A: the QUESTION itself" },
      content: { type: Type.STRING, description: "For CV/Activities: detailed description. For Q&A: the ANSWER to the question" },
      type: { type: Type.STRING, enum: ['experience', 'activity', 'education', 'qa', 'other'] },
      date: { type: Type.STRING },
      skills: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['title', 'content', 'type']
  }
};

export class KnowledgeService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  // 1. Parse File/Text into Structured Chunks
  async parseDocument(fileBase64: string, mimeType: string): Promise<KnowledgeItem[]> {
    logger.info("[RAG] Parsing document...");
    const prompt = `
      You are an expert document parser for interview preparation.

      FIRST, identify what type of document this is:
      - CV/Resume/Activities → Parse each job, activity, or education as separate items
      - Q&A Document (interview questions with answers) → Parse each Q&A pair as one item

      PARSING RULES:
      - For CV/Activities:
        * 'title': The job title, activity name, or degree
        * 'content': MUST be detailed - combine description, bullet points, metrics, outcomes
        * 'type': Use 'experience' (jobs), 'activity' (projects/extracurriculars), 'education', or 'other'
        * 'skills': Extract relevant skills mentioned

      - For Q&A Documents:
        * 'title': The QUESTION exactly as written
        * 'content': The complete ANSWER to that question
        * 'type': Use 'qa'
        * 'skills': Extract any skills/qualities mentioned in the answer (optional)

      Each Q&A pair becomes ONE chunk (question + answer together).
    `;

    const result = await this.ai.models.generateContent({
      model: ACTIVITY_PARSER_MODEL,
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: fileBase64 } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: DOCUMENT_SCHEMA
      }
    });

    if (!result.text) {
      throw new Error("Failed to parse document");
    }

    const rawItems = JSON.parse(result.text);
    logger.info(`[RAG] Parsed ${rawItems.length} items.`);

    return rawItems.map((item: any) => ({
      id: Math.random().toString(36).substring(7),
      title: item.title,
      content: item.content,
      metadata: {
        type: item.type,
        date: item.date,
        skills: item.skills
      }
    }));
  }

  // 1b. Parse Text (for pasted text, not file upload)
  async parseText(text: string): Promise<KnowledgeItem[]> {
    logger.info("[RAG] Parsing pasted text...");
    const prompt = `
      You are an expert document parser for interview preparation.

      FIRST, identify what type of document this is:
      - CV/Resume/Activities → Parse each job, activity, or education as separate items
      - Q&A Document (interview questions with answers) → Parse each Q&A pair as one item

      PARSING RULES:
      - For CV/Activities:
        * 'title': The job title, activity name, or degree
        * 'content': MUST be detailed - combine description, bullet points, metrics, outcomes
        * 'type': Use 'experience' (jobs), 'activity' (projects/extracurriculars), 'education', or 'other'
        * 'skills': Extract relevant skills mentioned

      - For Q&A Documents:
        * 'title': The QUESTION exactly as written
        * 'content': The complete ANSWER to that question
        * 'type': Use 'qa'
        * 'skills': Extract any skills/qualities mentioned in the answer (optional)

      Each Q&A pair becomes ONE chunk (question + answer together).

      TEXT TO PARSE:
      ${text}
    `;

    const result = await this.ai.models.generateContent({
      model: ACTIVITY_PARSER_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: DOCUMENT_SCHEMA
      }
    });

    if (!result.text) {
      throw new Error("Failed to parse text");
    }

    const rawItems = JSON.parse(result.text);
    logger.info(`[RAG] Parsed ${rawItems.length} items from text.`);

    return rawItems.map((item: any) => ({
      id: Math.random().toString(36).substring(7),
      title: item.title,
      content: item.content,
      metadata: {
        type: item.type,
        date: item.date,
        skills: item.skills
      }
    }));
  }

  // 2. Generate Embeddings for Chunks
  // Returns object with embedded items and failed items for transparency
  async embedItems(items: KnowledgeItem[]): Promise<{ embedded: KnowledgeItem[], failed: KnowledgeItem[] }> {
    logger.info(`[RAG] Generating embeddings for ${items.length} items...`);
    const embedded: KnowledgeItem[] = [];
    const failed: KnowledgeItem[] = [];

    for (const item of items) {
      // For Q&A items, embed question + answer together for better semantic matching
      const textToEmbed = item.metadata.type === 'qa'
        ? `Question: ${item.title}\nAnswer: ${item.content}`
        : `Title: ${item.title}\nType: ${item.metadata.type}\nContent: ${item.content}\nSkills: ${item.metadata.skills?.join(', ') || ''}`;

      try {
        const result = await this.ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: textToEmbed
        });

        embedded.push({
          ...item,
          embedding: result.embeddings?.[0]?.values || result.embedding?.values
        });
      } catch (e) {
        logger.error(`[RAG] Failed to embed item: ${item.title}`, e);
        // Keep the item without embedding - it won't be searchable but user can see it
        failed.push({
          ...item,
          embedding: undefined
        });
      }
    }
    logger.info(`[RAG] Embeddings complete. Success: ${embedded.length}/${items.length}, Failed: ${failed.length}`);
    return { embedded, failed };
  }

  // 3. Search (Vector Similarity)
  async findSimilar(query: string, items: KnowledgeItem[], topK: number = 5): Promise<KnowledgeItem[]> {
    if (items.length === 0) {
        logger.warn("[RAG] No items to search against.");
        return [];
    }

    logger.info(`[RAG] Embedding query: "${query.slice(0, 50)}..."`);
    let queryEmbedding: number[] | undefined;

    try {
        const queryResult = await this.ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: query
        });
        queryEmbedding = queryResult.embeddings?.[0]?.values || queryResult.embedding?.values;
    } catch (error) {
        logger.error("[RAG] EMBEDDING ERROR:", error);
        return []; // Return empty if we can't embed the query
    }

    if (!queryEmbedding) {
        logger.warn("[RAG] No embedding returned for query.");
        return [];
    }

    // Calculate Cosine Similarity
    const scoredItems = items.map(item => {
      if (!item.embedding) return { item, score: -1 };
      const score = this.cosineSimilarity(queryEmbedding!, item.embedding);
      return { item, score };
    });

    // Sort
    scoredItems.sort((a, b) => b.score - a.score);

    // Log Top Hits for Debugging
    logger.info("[RAG] Top Search Matches:");
    scoredItems.slice(0, 3).forEach((s, i) => {
        logger.info(`   ${i+1}. [${s.score.toFixed(4)}] ${s.item.title}`);
    });

    return scoredItems.slice(0, topK).map(s => s.item);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
