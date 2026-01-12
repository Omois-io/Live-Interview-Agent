/**
 * CV Parser Service - Uses Gemini to parse and structure CV/Personal Statement
 * Each section is extracted individually for better RAG retrieval
 */

import { GoogleGenAI } from "@google/genai";
import { ACTIVITY_PARSER_MODEL } from "../constants";
import { logger } from "./logger";

export interface ParsedCVSection {
  id: string;
  sectionType: CVSectionType;
  title: string;
  content: string;
  institution?: string;
  date?: string;
  keyPoints: string[];
  themes: string[]; // e.g., "research skills", "clinical exposure", "academic excellence"
  rawText: string;
}

export type CVSectionType =
  | 'education'
  | 'research'
  | 'clinical'
  | 'work'
  | 'leadership'
  | 'publications'
  | 'presentations'
  | 'awards'
  | 'certifications'
  | 'skills'
  | 'personal_statement'
  | 'other';

const CV_PARSER_PROMPT = `You are an expert at parsing medical school application CVs and personal statements.

Given a CV or personal statement text, extract and structure it into meaningful sections.

For each section, extract:
1. sectionType: One of: education, research, clinical, work, leadership, publications, presentations, awards, certifications, skills, personal_statement, other
2. title: The section heading or experience title
3. content: The full content of this section
4. institution: The institution/organization (if applicable)
5. date: Date range or year (if mentioned)
6. keyPoints: Array of 3-5 key accomplishments or highlights from this section
7. themes: Array of themes relevant for interview questions (e.g., ["research methodology", "problem solving", "academic excellence", "clinical exposure", "overcoming challenges", "motivation for medicine"])

Return a JSON array of sections. Be thorough in identifying themes - these help match CV sections to interview questions.

Common CV sections to look for:
- Education (undergraduate, graduate degrees)
- Research experiences (lab work, projects, publications)
- Clinical experiences (volunteering, scribing, shadowing)
- Work experiences
- Leadership positions
- Publications and presentations
- Awards and honors
- Skills and certifications
- Personal statement or narrative portions

Example output:
[
  {
    "sectionType": "education",
    "title": "Bachelor of Science in Biology",
    "content": "University of California, Berkeley. GPA: 3.9. Graduated summa cum laude. Dean's List all semesters.",
    "institution": "University of California, Berkeley",
    "date": "2019-2023",
    "keyPoints": [
      "Graduated summa cum laude with 3.9 GPA",
      "Dean's List all semesters",
      "Biology major with focus on molecular biology"
    ],
    "themes": ["academic excellence", "science foundation", "dedication"]
  },
  {
    "sectionType": "research",
    "title": "Cancer Biology Research Assistant",
    "content": "Dr. Smith Lab, Stanford University. Investigated mechanisms of drug resistance in breast cancer cells. Designed and executed experiments using cell culture, Western blotting, and RT-PCR. Co-authored paper published in Nature Communications.",
    "institution": "Stanford University",
    "date": "2021-2023",
    "keyPoints": [
      "Investigated drug resistance mechanisms in cancer",
      "Mastered cell culture, Western blotting, RT-PCR techniques",
      "Co-authored publication in Nature Communications",
      "Presented findings at regional research symposium"
    ],
    "themes": ["research skills", "scientific thinking", "perseverance", "publication success", "technical skills", "problem solving"]
  },
  {
    "sectionType": "personal_statement",
    "title": "Personal Statement Opening",
    "content": "The steady beep of the heart monitor was the only sound in the room as I held Mrs. Johnson's hand. She had just received news that her cancer had returned...",
    "keyPoints": [
      "Pivotal patient interaction that shaped career choice",
      "Understanding of physician's role in difficult moments",
      "Commitment to compassionate care"
    ],
    "themes": ["motivation for medicine", "empathy", "patient care", "defining moment", "compassion"]
  }
]

Parse the following CV/Personal Statement:`;

export class CVParserService {
  private ai: GoogleGenAI;
  private parsedSections: ParsedCVSection[] = [];
  private isParsing: boolean = false;
  private model: string;

  constructor(apiKey: string, model: string = ACTIVITY_PARSER_MODEL) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  /**
   * Parse raw CV text into structured sections using Gemini
   */
  async parseCV(rawText: string): Promise<ParsedCVSection[]> {
    if (!rawText.trim()) {
      return [];
    }

    this.isParsing = true;

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: `${CV_PARSER_PROMPT}\n\n${rawText}`,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text || '';

      // Parse JSON response
      let sections: any[];
      try {
        sections = JSON.parse(text);
      } catch (e) {
        // Try to extract JSON from response if wrapped in markdown
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          sections = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Failed to parse CV JSON');
        }
      }

      // Convert to ParsedCVSection with IDs
      this.parsedSections = sections.map((section: any, index: number) => ({
        id: `cv_section_${index}_${Date.now()}`,
        sectionType: this.normalizeSectionType(section.sectionType),
        title: section.title || `Section ${index + 1}`,
        content: section.content || '',
        institution: section.institution,
        date: section.date,
        keyPoints: section.keyPoints || [],
        themes: section.themes || [],
        rawText: section.content || '',
      }));

      logger.info(`Parsed ${this.parsedSections.length} CV sections`);
      return this.parsedSections;

    } catch (error) {
      logger.error('Failed to parse CV:', error);
      // Fallback: treat entire CV as one section
      return this.fallbackParse(rawText);
    } finally {
      this.isParsing = false;
    }
  }

  /**
   * Get CV sections formatted for embedding
   * Each section becomes its own chunk with rich context
   */
  getSectionsForEmbedding(): Array<{
    id: string;
    content: string;
    sectionType: CVSectionType;
    themes: string[];
  }> {
    return this.parsedSections.map(section => ({
      id: section.id,
      content: this.formatSectionForEmbedding(section),
      sectionType: section.sectionType,
      themes: section.themes,
    }));
  }

  /**
   * Format a single CV section for embedding with rich searchable context
   */
  private formatSectionForEmbedding(section: ParsedCVSection): string {
    let text = `CV Section: ${section.title}\n`;
    text += `Type: ${section.sectionType}\n`;

    if (section.institution) {
      text += `Institution: ${section.institution}\n`;
    }

    if (section.date) {
      text += `Date: ${section.date}\n`;
    }

    text += `Content: ${section.content}\n`;

    if (section.keyPoints.length > 0) {
      text += `Key Points:\n`;
      section.keyPoints.forEach(point => {
        text += `  - ${point}\n`;
      });
    }

    if (section.themes.length > 0) {
      text += `Relevant themes: ${section.themes.join(', ')}\n`;
    }

    return text;
  }

  /**
   * Normalize section type to valid enum value
   */
  private normalizeSectionType(type: string): CVSectionType {
    const normalized = (type || '').toLowerCase().trim();
    const validTypes: CVSectionType[] = [
      'education', 'research', 'clinical', 'work', 'leadership',
      'publications', 'presentations', 'awards', 'certifications',
      'skills', 'personal_statement', 'other'
    ];

    if (validTypes.includes(normalized as CVSectionType)) {
      return normalized as CVSectionType;
    }

    // Map common variations
    if (normalized.includes('educat') || normalized.includes('degree') || normalized.includes('university')) return 'education';
    if (normalized.includes('research') || normalized.includes('lab')) return 'research';
    if (normalized.includes('clinical') || normalized.includes('hospital') || normalized.includes('patient')) return 'clinical';
    if (normalized.includes('work') || normalized.includes('employ') || normalized.includes('job')) return 'work';
    if (normalized.includes('leader') || normalized.includes('president') || normalized.includes('officer')) return 'leadership';
    if (normalized.includes('publication') || normalized.includes('paper') || normalized.includes('journal')) return 'publications';
    if (normalized.includes('presentation') || normalized.includes('poster') || normalized.includes('conference')) return 'presentations';
    if (normalized.includes('award') || normalized.includes('honor') || normalized.includes('scholarship')) return 'awards';
    if (normalized.includes('certif') || normalized.includes('license')) return 'certifications';
    if (normalized.includes('skill') || normalized.includes('competenc')) return 'skills';
    if (normalized.includes('statement') || normalized.includes('essay') || normalized.includes('narrative')) return 'personal_statement';

    return 'other';
  }

  /**
   * Fallback parsing when Gemini fails - split into paragraphs
   */
  private fallbackParse(rawText: string): ParsedCVSection[] {
    // Split by double newlines (paragraphs)
    const paragraphs = rawText.split(/\n\s*\n+/);

    return paragraphs
      .filter(p => p.trim().length > 50)
      .map((paragraph, index) => ({
        id: `cv_section_${index}_${Date.now()}`,
        sectionType: 'other' as CVSectionType,
        title: paragraph.slice(0, 50).trim() + '...',
        content: paragraph.trim(),
        keyPoints: [],
        themes: [],
        rawText: paragraph.trim(),
      }));
  }

  /**
   * Get parsed CV sections
   */
  getParsedSections(): ParsedCVSection[] {
    return this.parsedSections;
  }

  /**
   * Check if currently parsing
   */
  getIsParsing(): boolean {
    return this.isParsing;
  }

  /**
   * Find sections matching specific themes
   */
  findSectionsByTheme(theme: string): ParsedCVSection[] {
    const normalizedTheme = theme.toLowerCase();
    return this.parsedSections.filter(section =>
      section.themes.some(t => t.toLowerCase().includes(normalizedTheme)) ||
      section.sectionType.includes(normalizedTheme) ||
      section.content.toLowerCase().includes(normalizedTheme)
    );
  }

  /**
   * Get sections by type
   */
  getSectionsByType(type: CVSectionType): ParsedCVSection[] {
    return this.parsedSections.filter(s => s.sectionType === type);
  }

  /**
   * Clear parsed sections
   */
  clear(): void {
    this.parsedSections = [];
  }
}
