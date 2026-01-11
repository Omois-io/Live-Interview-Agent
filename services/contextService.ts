/**
 * Context Service - Manages CV and Activities storage for personalized answers
 * Stores in localStorage for persistence across sessions
 */

const CV_KEY = "interview_hud_cv";
const ACTIVITIES_KEY = "interview_hud_activities";

export const contextService = {
  /**
   * Save CV/Personal Statement content
   */
  saveCV(content: string): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(CV_KEY, content);
    }
  },

  /**
   * Load CV/Personal Statement content
   */
  loadCV(): string | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(CV_KEY);
    }
    return null;
  },

  /**
   * Save 15 Activities (AMCAS/AACOMAS format)
   */
  saveActivities(activities: string): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(ACTIVITIES_KEY, activities);
    }
  },

  /**
   * Load 15 Activities
   */
  loadActivities(): string | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(ACTIVITIES_KEY);
    }
    return null;
  },

  /**
   * Clear all context data
   */
  clearAll(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(CV_KEY);
      localStorage.removeItem(ACTIVITIES_KEY);
    }
  },

  /**
   * Check if any context has been provided
   */
  hasContext(): boolean {
    return !!(this.loadCV() || this.loadActivities());
  },

  /**
   * Get formatted context for system prompt inclusion
   */
  getFullContext(): string {
    const cv = this.loadCV();
    const activities = this.loadActivities();

    if (!cv && !activities) {
      return "No background information provided.";
    }

    let context = "";

    if (cv) {
      context += `=== CANDIDATE CV / PERSONAL STATEMENT ===\n${cv}\n\n`;
    }

    if (activities) {
      context += `=== 15 ACTIVITIES (AMCAS/AACOMAS) ===\n${activities}`;
    }

    return context.trim();
  }
};
