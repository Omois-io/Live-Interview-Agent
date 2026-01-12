/**
 * Embedding Service - Uses Gemini embeddings for semantic question matching
 *
 * Extended to support:
 * - Interview Q&A matching
 * - CV/Activities context chunks
 * - School-specific artifact chunks
 */

import { GoogleGenAI } from "@google/genai";
import { InterviewQA } from "../types";
import { contextService } from "./contextService";
import { artifactService, ArtifactChunk } from "./artifactService";
import { ActivityParserService, ParsedActivity } from "./activityParserService";
import { CVParserService, ParsedCVSection } from "./cvParserService";
import { EMBEDDING_MODEL, ACTIVITY_PARSER_MODEL } from "../constants";
import { logger } from "./logger";

export interface EmbeddingMatch {
  id: string;
  score: number;
  question: string;
  source?: 'qa' | 'cv' | 'activities' | 'artifact';
  content?: string;
}

export interface EmbeddedChunk {
  id: string;
  content: string;
  source: string;
  type: 'qa' | 'cv' | 'activities' | 'artifact';
  embedding: number[];
  metadata?: {
    artifactId?: string;
    schoolName?: string;
    questionId?: string;
  };
}

// Storage keys
const EMBEDDINGS_CACHE_KEY = "interview_hud_embeddings_cache";
const EMBEDDINGS_QUESTIONS_KEY = "interview_hud_embeddings_questions";
const EMBEDDINGS_CHUNKS_KEY = "interview_hud_embeddings_chunks";
const EMBEDDINGS_ACTIVITIES_KEY = "interview_hud_embeddings_activities";
const EMBEDDINGS_CV_SECTIONS_KEY = "interview_hud_embeddings_cv_sections";
const EMBEDDINGS_HASH_KEY = "interview_hud_embeddings_hash";

export class EmbeddingService {
  private ai: GoogleGenAI;
  private cache: Map<string, number[]> = new Map();
  private questionMap: Map<string, InterviewQA> = new Map();
  private chunks: EmbeddedChunk[] = [];
  private parsedActivities: ParsedActivity[] = [];
  private parsedCVSections: ParsedCVSection[] = [];
  private activityParser: ActivityParserService;
  private cvParser: CVParserService;
  private isInitialized: boolean = false;
  private embeddingModel: string;

  // Chunk configuration (fallback only)
  private readonly CHUNK_SIZE = 500;
  private readonly CHUNK_OVERLAP = 50;

  constructor(
    apiKey: string,
    embeddingModel: string = EMBEDDING_MODEL,
    parserModel: string = ACTIVITY_PARSER_MODEL
  ) {
    this.ai = new GoogleGenAI({ apiKey });
    this.embeddingModel = embeddingModel;
    this.activityParser = new ActivityParserService(apiKey, parserModel);
    this.cvParser = new CVParserService(apiKey, parserModel);
  }

  /**
   * Get embedding for a single text
   */
  async embedText(text: string): Promise<number[]> {
    try {
      const response = await this.ai.models.embedContent({
        model: this.embeddingModel,
        contents: text,
      });

      // Extract embedding values from response
      if (response.embeddings && response.embeddings.length > 0) {
        return response.embeddings[0].values || [];
      }

      throw new Error("No embeddings returned from API");
    } catch (error) {
      logger.error("Error getting embedding", error);
      throw error;
    }
  }

  /**
   * Initialize embeddings for all questions in the knowledge base
   * Call this once when session starts or when questions change
   */
  async initializeEmbeddings(questions: InterviewQA[]): Promise<void> {
    logger.info(`Initializing embeddings for ${questions.length} questions...`);

    this.cache.clear();
    this.questionMap.clear();

    for (const q of questions) {
      try {
        const embedding = await this.embedText(q.question);
        this.cache.set(q.id, embedding);
        this.questionMap.set(q.id, q);
      } catch (error) {
        logger.error(`Failed to embed question ${q.id}:`, error);
      }
    }

    this.isInitialized = true;
    logger.info(`Embeddings initialized for ${this.cache.size} questions`);
  }

  /**
   * Find best matching question from the knowledge base
   * Returns null if no good match found (below threshold)
   */
  findBestMatch(queryEmbedding: number[], threshold: number = 0.85): EmbeddingMatch | null {
    if (!this.isInitialized || this.cache.size === 0) {
      return null;
    }

    let bestMatch: EmbeddingMatch | null = null;

    for (const [id, embedding] of this.cache) {
      const score = this.cosineSimilarity(queryEmbedding, embedding);

      if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
        const q = this.questionMap.get(id);
        bestMatch = {
          id,
          score,
          question: q?.question || ""
        };
      }
    }

    if (bestMatch) {
      logger.info(`Embedding match found: "${bestMatch.question}" (score: ${bestMatch.score.toFixed(3)})`);
    }

    return bestMatch;
  }

  /**
   * Find top N matching questions (for debugging/analysis)
   */
  findTopMatches(queryEmbedding: number[], topN: number = 3): EmbeddingMatch[] {
    if (!this.isInitialized || this.cache.size === 0) {
      return [];
    }

    const matches: EmbeddingMatch[] = [];

    for (const [id, embedding] of this.cache) {
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      const q = this.questionMap.get(id);
      matches.push({
        id,
        score,
        question: q?.question || ""
      });
    }

    // Sort by score descending and take top N
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  /**
   * Check if embeddings have been initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.cache.size > 0;
  }

  /**
   * Get the number of cached embeddings
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Clear all cached embeddings
   */
  clearCache(): void {
    this.cache.clear();
    this.questionMap.clear();
    this.chunks = [];
    this.parsedActivities = [];
    this.parsedCVSections = [];
    this.activityParser.clear();
    this.cvParser.clear();
    this.isInitialized = false;
  }

  // ==================== EXTENDED EMBEDDING METHODS ====================

  /**
   * Initialize all embeddings including Q&A, CV, activities, and artifacts
   */
  async initializeAllEmbeddings(
    questions: InterviewQA[],
    schoolName?: string
  ): Promise<void> {
    logger.info('Initializing comprehensive embeddings...');

    // 1. Initialize Q&A embeddings (existing behavior)
    await this.initializeEmbeddings(questions);

    // 2. Parse and embed CV sections using Gemini
    const cv = contextService.loadCV();
    if (cv) {
      try {
        // Parse CV into structured sections
        logger.info('Parsing CV with Gemini...');
        this.parsedCVSections = await this.cvParser.parseCV(cv);

        // Embed each CV section individually
        const cvSections = this.cvParser.getSectionsForEmbedding();
        for (const section of cvSections) {
          try {
            const embedding = await this.embedText(section.content);
            this.chunks.push({
              id: section.id,
              content: section.content,
              source: `CV: ${section.sectionType}`,
              type: 'cv',
              embedding,
              metadata: {
                sectionType: section.sectionType,
                themes: section.themes,
              },
            });
          } catch (error) {
            logger.error('Failed to embed CV section:', error);
          }
        }
        logger.info(`Parsed and embedded ${this.parsedCVSections.length} CV sections`);
      } catch (error) {
        logger.error('Failed to parse CV, falling back to chunking:', error);
        // Fallback to simple chunking
        const cvChunks = this.chunkText(cv, 'cv');
        for (const chunk of cvChunks) {
          try {
            const embedding = await this.embedText(chunk.content);
            this.chunks.push({
              ...chunk,
              embedding,
            });
          } catch (error) {
            logger.error('Failed to embed CV chunk:', error);
          }
        }
      }
    }

    // 3. Parse and embed individual activities using Gemini
    const activitiesRaw = contextService.loadActivities();
    if (activitiesRaw) {
      try {
        // Parse activities into structured format
        logger.info('Parsing activities with Gemini...');
        this.parsedActivities = await this.activityParser.parseActivities(activitiesRaw);

        // Embed each activity individually
        const activityEmbeddings = this.activityParser.getActivitiesForEmbedding();
        for (const activity of activityEmbeddings) {
          try {
            const embedding = await this.embedText(activity.content);
            this.chunks.push({
              id: activity.id,
              content: activity.content,
              source: `Activity: ${activity.type}`,
              type: 'activities',
              embedding,
              metadata: {
                activityType: activity.type,
                themes: activity.themes,
                isMostMeaningful: activity.isMostMeaningful,
              },
            });
          } catch (error) {
            logger.error('Failed to embed activity:', error);
          }
        }
        logger.info(`Parsed and embedded ${this.parsedActivities.length} individual activities`);
      } catch (error) {
        logger.error('Failed to parse activities, falling back to chunking:', error);
        // Fallback to simple chunking
        const activityChunks = this.chunkText(activitiesRaw, 'activities');
        for (const chunk of activityChunks) {
          try {
            const embedding = await this.embedText(chunk.content);
            this.chunks.push({
              ...chunk,
              embedding,
            });
          } catch (error) {
            logger.error('Failed to embed activities chunk:', error);
          }
        }
      }
    }

    // 4. Embed school-specific artifacts
    if (schoolName) {
      const artifactChunks = artifactService.getSchoolChunks(schoolName);
      for (const chunk of artifactChunks) {
        try {
          const embedding = await this.embedText(chunk.content);
          this.chunks.push({
            id: chunk.id,
            content: chunk.content,
            source: `Artifact: ${chunk.artifactId}`,
            type: 'artifact',
            embedding,
            metadata: {
              artifactId: chunk.artifactId,
              schoolName,
            },
          });
        } catch (error) {
          logger.error('Failed to embed artifact chunk:', error);
        }
      }
      logger.info(`Embedded ${artifactChunks.length} artifact chunks for ${schoolName}`);
    }

    logger.info(`Total embedded chunks: ${this.chunks.length}`);

    // Save embeddings to localStorage for next session
    this.saveEmbeddings(questions, schoolName);
  }

  /**
   * Chunk text into smaller pieces for embedding
   */
  private chunkText(
    text: string,
    type: 'cv' | 'activities' | 'artifact'
  ): Omit<EmbeddedChunk, 'embedding'>[] {
    const chunks: Omit<EmbeddedChunk, 'embedding'>[] = [];
    let startIndex = 0;
    let chunkIndex = 0;

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + this.CHUNK_SIZE, text.length);

      // Try to end at a sentence boundary
      let adjustedEnd = endIndex;
      if (endIndex < text.length) {
        const lastPeriod = text.lastIndexOf('.', endIndex);
        const lastNewline = text.lastIndexOf('\n', endIndex);
        const boundary = Math.max(lastPeriod, lastNewline);

        if (boundary > startIndex + this.CHUNK_SIZE * 0.5) {
          adjustedEnd = boundary + 1;
        }
      }

      const content = text.slice(startIndex, adjustedEnd).trim();

      if (content.length > 0) {
        chunks.push({
          id: `${type}_chunk_${chunkIndex}`,
          content,
          source: type === 'cv' ? 'Personal Statement/CV' :
                  type === 'activities' ? '15 AMCAS Activities' : 'Artifact',
          type,
        });
        chunkIndex++;
      }

      startIndex = adjustedEnd - this.CHUNK_OVERLAP;
      if (startIndex >= text.length - this.CHUNK_OVERLAP) break;
    }

    return chunks;
  }

  /**
   * Find relevant chunks for a given query
   * Returns chunks from all sources (CV, activities, artifacts) sorted by relevance
   */
  async findRelevantChunks(
    query: string,
    topN: number = 5,
    minScore: number = 0.7
  ): Promise<EmbeddedChunk[]> {
    if (this.chunks.length === 0) return [];

    const queryEmbedding = await this.embedText(query);
    const scored: { chunk: EmbeddedChunk; score: number }[] = [];

    for (const chunk of this.chunks) {
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= minScore) {
        scored.push({ chunk, score });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(s => s.chunk);
  }

  /**
   * Find best matches across all sources (Q&A + chunks)
   * Returns both question matches and relevant context chunks
   */
  async findComprehensiveMatches(
    query: string,
    options: {
      qaThreshold?: number;
      chunkThreshold?: number;
      maxQAMatches?: number;
      maxChunks?: number;
    } = {}
  ): Promise<{
    qaMatches: EmbeddingMatch[];
    contextChunks: EmbeddedChunk[];
  }> {
    const {
      qaThreshold = 0.85,
      chunkThreshold = 0.7,
      maxQAMatches = 3,
      maxChunks = 5,
    } = options;

    const queryEmbedding = await this.embedText(query);

    // Find Q&A matches
    const qaMatches = this.findTopMatches(queryEmbedding, maxQAMatches)
      .filter(m => m.score >= qaThreshold);

    // Find context chunks
    const contextChunks: EmbeddedChunk[] = [];
    const chunkScores: { chunk: EmbeddedChunk; score: number }[] = [];

    for (const chunk of this.chunks) {
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= chunkThreshold) {
        chunkScores.push({ chunk, score });
      }
    }

    chunkScores
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks)
      .forEach(s => contextChunks.push(s.chunk));

    return { qaMatches, contextChunks };
  }

  /**
   * Get total number of embedded items
   */
  getTotalEmbeddings(): { qa: number; chunks: number; activities: number } {
    return {
      qa: this.cache.size,
      chunks: this.chunks.length,
      activities: this.parsedActivities.length,
    };
  }

  /**
   * Get parsed activities for display
   */
  getParsedActivities(): ParsedActivity[] {
    return this.parsedActivities;
  }

  /**
   * Get parsed CV sections for display
   */
  getParsedCVSections(): ParsedCVSection[] {
    return this.parsedCVSections;
  }

  /**
   * Get activity parser instance for direct access
   */
  getActivityParser(): ActivityParserService {
    return this.activityParser;
  }

  /**
   * Get CV parser instance for direct access
   */
  getCVParser(): CVParserService {
    return this.cvParser;
  }

  /**
   * Cosine similarity between two vectors
   * Returns a value between -1 and 1, where 1 means identical
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      logger.warn("Embedding dimension mismatch:", a.length, "vs", b.length);
      return 0;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);

    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  /**
   * Generate a simple hash of the source documents to detect changes
   */
  private hashDocuments(questions: InterviewQA[], schoolName?: string): string {
    const cv = contextService.loadCV() || '';
    const activities = contextService.loadActivities() || '';
    const artifacts = schoolName ? artifactService.getSchoolArtifactChunks(schoolName) : [];

    const questionsStr = questions.map(q => `${q.id}:${q.question}:${q.answer}`).join('|');
    const artifactsStr = artifacts.map(a => `${a.id}:${a.content}`).join('|');

    const combined = `${questionsStr}|${cv}|${activities}|${artifactsStr}`;

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  /**
   * Save embeddings to localStorage
   */
  private saveEmbeddings(questions: InterviewQA[], schoolName?: string): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;

      const hash = this.hashDocuments(questions, schoolName);

      // Convert Map to array for storage
      const cacheArray = Array.from(this.cache.entries());
      const questionMapArray = Array.from(this.questionMap.entries());

      localStorage.setItem(EMBEDDINGS_CACHE_KEY, JSON.stringify(cacheArray));
      localStorage.setItem(EMBEDDINGS_QUESTIONS_KEY, JSON.stringify(questionMapArray));
      localStorage.setItem(EMBEDDINGS_CHUNKS_KEY, JSON.stringify(this.chunks));
      localStorage.setItem(EMBEDDINGS_ACTIVITIES_KEY, JSON.stringify(this.parsedActivities));
      localStorage.setItem(EMBEDDINGS_CV_SECTIONS_KEY, JSON.stringify(this.parsedCVSections));
      localStorage.setItem(EMBEDDINGS_HASH_KEY, hash);

      logger.info(`Saved embeddings: ${this.cache.size} Q&A, ${this.chunks.length} chunks (${this.parsedCVSections.length} CV sections, ${this.parsedActivities.length} activities), hash: ${hash}`);
    } catch (error) {
      logger.warn('Failed to save embeddings to localStorage:', error);
    }
  }

  /**
   * Load embeddings from localStorage if they exist and documents haven't changed
   * Returns true if loaded successfully, false otherwise
   */
  loadCachedEmbeddings(questions: InterviewQA[], schoolName?: string): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;

      const savedHash = localStorage.getItem(EMBEDDINGS_HASH_KEY);
      const currentHash = this.hashDocuments(questions, schoolName);

      // Check if documents have changed
      if (savedHash !== currentHash) {
        logger.info('Documents have changed, embeddings cache invalid');
        return false;
      }

      // Load cached data
      const cacheData = localStorage.getItem(EMBEDDINGS_CACHE_KEY);
      const questionsData = localStorage.getItem(EMBEDDINGS_QUESTIONS_KEY);
      const chunksData = localStorage.getItem(EMBEDDINGS_CHUNKS_KEY);
      const activitiesData = localStorage.getItem(EMBEDDINGS_ACTIVITIES_KEY);
      const cvSectionsData = localStorage.getItem(EMBEDDINGS_CV_SECTIONS_KEY);

      if (!cacheData || !questionsData || !chunksData) {
        logger.info('No cached embeddings found');
        return false;
      }

      // Restore data structures
      const cacheArray: [string, number[]][] = JSON.parse(cacheData);
      const questionMapArray: [string, InterviewQA][] = JSON.parse(questionsData);

      this.cache = new Map(cacheArray);
      this.questionMap = new Map(questionMapArray);
      this.chunks = JSON.parse(chunksData);
      this.parsedActivities = activitiesData ? JSON.parse(activitiesData) : [];
      this.parsedCVSections = cvSectionsData ? JSON.parse(cvSectionsData) : [];
      this.isInitialized = true;

      logger.info(`Loaded cached embeddings: ${this.cache.size} Q&A, ${this.chunks.length} chunks (${this.parsedCVSections.length} CV sections, ${this.parsedActivities.length} activities)`);
      return true;
    } catch (error) {
      logger.warn('Failed to load cached embeddings:', error);
      return false;
    }
  }

  /**
   * Clear cached embeddings from localStorage
   */
  clearCachedEmbeddings(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;

      localStorage.removeItem(EMBEDDINGS_CACHE_KEY);
      localStorage.removeItem(EMBEDDINGS_QUESTIONS_KEY);
      localStorage.removeItem(EMBEDDINGS_CHUNKS_KEY);
      localStorage.removeItem(EMBEDDINGS_ACTIVITIES_KEY);
      localStorage.removeItem(EMBEDDINGS_CV_SECTIONS_KEY);
      localStorage.removeItem(EMBEDDINGS_HASH_KEY);

      logger.info('Cleared cached embeddings');
    } catch (error) {
      logger.warn('Failed to clear cached embeddings:', error);
    }
  }
}
