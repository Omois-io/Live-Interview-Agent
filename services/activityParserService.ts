/**
 * Activity Parser Service - Uses Gemini to parse and structure AMCAS/AACOMAS activities
 * Each activity is extracted individually for better RAG retrieval
 */

import { GoogleGenAI } from "@google/genai";
import { ACTIVITY_PARSER_MODEL } from "../constants";
import { logger } from "./logger";

export interface ParsedActivity {
  id: string;
  name: string;
  type: ActivityType;
  organization: string;
  description: string;
  hours: number;
  startDate?: string;
  endDate?: string;
  isMostMeaningful: boolean;
  mostMeaningfulEssay?: string;
  skills: string[];
  themes: string[]; // e.g., "leadership", "teamwork", "research", "patient care"
  rawText: string;
}

export type ActivityType =
  | 'research'
  | 'clinical'
  | 'volunteer'
  | 'leadership'
  | 'teaching'
  | 'shadowing'
  | 'work'
  | 'extracurricular'
  | 'honors'
  | 'other';

const ACTIVITY_PARSER_PROMPT = `You are an expert at parsing medical school application activities (AMCAS/AACOMAS format).

Given raw text containing one or more activities, extract each activity into a structured format.

For each activity, extract:
1. name: The activity/experience name
2. type: One of: research, clinical, volunteer, leadership, teaching, shadowing, work, extracurricular, honors, other
3. organization: Where this took place
4. description: The main description of what was done
5. hours: Total hours (estimate if not explicit)
6. startDate: When it started (if mentioned)
7. endDate: When it ended or "Present" (if mentioned)
8. isMostMeaningful: true if marked as most meaningful
9. mostMeaningfulEssay: The additional essay if this is a most meaningful activity
10. skills: Array of skills demonstrated (e.g., ["communication", "data analysis", "patient interaction"])
11. themes: Array of themes this relates to for interview questions (e.g., ["leadership", "teamwork", "overcoming challenges", "patient care", "research methodology"])

Return a JSON array of activities. Be thorough in identifying themes - these help match activities to interview questions.

Example output:
[
  {
    "name": "Emergency Department Volunteer",
    "type": "clinical",
    "organization": "City General Hospital",
    "description": "Assisted nurses with patient transport, restocked supplies, provided comfort to patients and families in the waiting room.",
    "hours": 200,
    "startDate": "2021-06",
    "endDate": "2023-05",
    "isMostMeaningful": true,
    "mostMeaningfulEssay": "This experience solidified my desire to become a physician...",
    "skills": ["patient communication", "teamwork", "time management", "empathy"],
    "themes": ["patient care", "healthcare exposure", "compassion", "teamwork", "motivation for medicine"]
  }
]

Parse the following activities text:`;

export class ActivityParserService {
  private ai: GoogleGenAI;
  private parsedActivities: ParsedActivity[] = [];
  private isParsing: boolean = false;
  private model: string;

  constructor(apiKey: string, model: string = ACTIVITY_PARSER_MODEL) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  /**
   * Parse raw activities text into structured activities using Gemini
   */
  async parseActivities(rawText: string): Promise<ParsedActivity[]> {
    if (!rawText.trim()) {
      return [];
    }

    this.isParsing = true;

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: `${ACTIVITY_PARSER_PROMPT}\n\n${rawText}`,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text || '';

      // Parse JSON response
      let activities: any[];
      try {
        activities = JSON.parse(text);
      } catch (e) {
        // Try to extract JSON from response if wrapped in markdown
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          activities = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Failed to parse activities JSON');
        }
      }

      // Convert to ParsedActivity with IDs
      this.parsedActivities = activities.map((act: any, index: number) => ({
        id: `activity_${index}_${Date.now()}`,
        name: act.name || `Activity ${index + 1}`,
        type: this.normalizeActivityType(act.type),
        organization: act.organization || '',
        description: act.description || '',
        hours: act.hours || 0,
        startDate: act.startDate,
        endDate: act.endDate,
        isMostMeaningful: act.isMostMeaningful || false,
        mostMeaningfulEssay: act.mostMeaningfulEssay,
        skills: act.skills || [],
        themes: act.themes || [],
        rawText: this.reconstructRawText(act),
      }));

      logger.info(`Parsed ${this.parsedActivities.length} activities`);
      return this.parsedActivities;

    } catch (error) {
      logger.error('Failed to parse activities:', error);
      // Fallback: treat entire text as one activity
      return this.fallbackParse(rawText);
    } finally {
      this.isParsing = false;
    }
  }

  /**
   * Get activities formatted for embedding
   * Each activity becomes its own chunk with rich context
   */
  getActivitiesForEmbedding(): Array<{
    id: string;
    content: string;
    type: ActivityType;
    themes: string[];
    isMostMeaningful: boolean;
  }> {
    return this.parsedActivities.map(activity => ({
      id: activity.id,
      content: this.formatActivityForEmbedding(activity),
      type: activity.type,
      themes: activity.themes,
      isMostMeaningful: activity.isMostMeaningful,
    }));
  }

  /**
   * Format a single activity for embedding with rich searchable context
   */
  private formatActivityForEmbedding(activity: ParsedActivity): string {
    let text = `Activity: ${activity.name}\n`;
    text += `Type: ${activity.type}\n`;
    text += `Organization: ${activity.organization}\n`;
    text += `Description: ${activity.description}\n`;

    if (activity.hours) {
      text += `Hours: ${activity.hours}\n`;
    }

    if (activity.skills.length > 0) {
      text += `Skills demonstrated: ${activity.skills.join(', ')}\n`;
    }

    if (activity.themes.length > 0) {
      text += `Relevant themes: ${activity.themes.join(', ')}\n`;
    }

    if (activity.isMostMeaningful && activity.mostMeaningfulEssay) {
      text += `Most Meaningful Essay: ${activity.mostMeaningfulEssay}\n`;
    }

    return text;
  }

  /**
   * Reconstruct raw text from parsed activity
   */
  private reconstructRawText(act: any): string {
    let text = `${act.name || ''}\n`;
    text += `${act.organization || ''}\n`;
    text += `${act.description || ''}\n`;
    if (act.mostMeaningfulEssay) {
      text += `${act.mostMeaningfulEssay}\n`;
    }
    return text.trim();
  }

  /**
   * Normalize activity type to valid enum value
   */
  private normalizeActivityType(type: string): ActivityType {
    const normalized = (type || '').toLowerCase().trim();
    const validTypes: ActivityType[] = [
      'research', 'clinical', 'volunteer', 'leadership',
      'teaching', 'shadowing', 'work', 'extracurricular', 'honors', 'other'
    ];

    if (validTypes.includes(normalized as ActivityType)) {
      return normalized as ActivityType;
    }

    // Map common variations
    if (normalized.includes('research') || normalized.includes('lab')) return 'research';
    if (normalized.includes('clinical') || normalized.includes('hospital') || normalized.includes('patient')) return 'clinical';
    if (normalized.includes('volunteer') || normalized.includes('service')) return 'volunteer';
    if (normalized.includes('leader') || normalized.includes('president') || normalized.includes('captain')) return 'leadership';
    if (normalized.includes('teach') || normalized.includes('tutor') || normalized.includes('mentor')) return 'teaching';
    if (normalized.includes('shadow')) return 'shadowing';
    if (normalized.includes('work') || normalized.includes('employ') || normalized.includes('job')) return 'work';
    if (normalized.includes('honor') || normalized.includes('award')) return 'honors';

    return 'other';
  }

  /**
   * Fallback parsing when Gemini fails - split by common delimiters
   */
  private fallbackParse(rawText: string): ParsedActivity[] {
    // Try to split by numbered activities or double newlines
    const sections = rawText.split(/(?:\n\s*\n|\n\d+[\.\)]\s*)/);

    return sections
      .filter(s => s.trim().length > 50) // Filter out short fragments
      .map((section, index) => ({
        id: `activity_${index}_${Date.now()}`,
        name: section.slice(0, 50).trim() + '...',
        type: 'other' as ActivityType,
        organization: '',
        description: section.trim(),
        hours: 0,
        isMostMeaningful: false,
        skills: [],
        themes: [],
        rawText: section.trim(),
      }));
  }

  /**
   * Get parsed activities
   */
  getParsedActivities(): ParsedActivity[] {
    return this.parsedActivities;
  }

  /**
   * Check if currently parsing
   */
  getIsParsing(): boolean {
    return this.isParsing;
  }

  /**
   * Find activities matching specific themes
   */
  findActivitiesByTheme(theme: string): ParsedActivity[] {
    const normalizedTheme = theme.toLowerCase();
    return this.parsedActivities.filter(activity =>
      activity.themes.some(t => t.toLowerCase().includes(normalizedTheme)) ||
      activity.type.includes(normalizedTheme) ||
      activity.description.toLowerCase().includes(normalizedTheme)
    );
  }

  /**
   * Get most meaningful activities
   */
  getMostMeaningful(): ParsedActivity[] {
    return this.parsedActivities.filter(a => a.isMostMeaningful);
  }

  /**
   * Clear parsed activities
   */
  clear(): void {
    this.parsedActivities = [];
  }
}
