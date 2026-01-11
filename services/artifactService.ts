/**
 * Artifact Service - Manages storage and retrieval of interview artifacts
 * Artifacts include: recordings, transcripts, school-specific information
 */

import { RecordingMetadata } from './recordingService';

const ARTIFACTS_KEY = 'interview_hud_artifacts';
const SCHOOL_INFO_KEY = 'interview_hud_schools';

export interface Artifact {
  id: string;
  type: 'recording' | 'transcript' | 'document' | 'notes';
  name: string;
  content?: string; // For text-based artifacts
  blobUrl?: string; // For audio/video artifacts (runtime only)
  filePath?: string; // For Electron file storage
  schoolName?: string;
  tags: string[];
  createdAt: number;
  metadata?: RecordingMetadata;
}

export interface SchoolInfo {
  id: string;
  name: string;
  mission?: string;
  values?: string[];
  programs?: string[];
  notes?: string;
  artifacts: string[]; // Artifact IDs
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactChunk {
  id: string;
  artifactId: string;
  content: string;
  startIndex: number;
  endIndex: number;
  embedding?: number[];
}

class ArtifactService {
  private artifacts: Map<string, Artifact> = new Map();
  private schools: Map<string, SchoolInfo> = new Map();
  private chunks: Map<string, ArtifactChunk[]> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  // ==================== ARTIFACT MANAGEMENT ====================

  /**
   * Add a new artifact
   */
  addArtifact(artifact: Omit<Artifact, 'id' | 'createdAt'>): Artifact {
    const newArtifact: Artifact = {
      ...artifact,
      id: `artifact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
    };

    this.artifacts.set(newArtifact.id, newArtifact);
    this.saveToStorage();

    // If associated with a school, update school's artifact list
    if (artifact.schoolName) {
      this.linkArtifactToSchool(newArtifact.id, artifact.schoolName);
    }

    return newArtifact;
  }

  /**
   * Add a recording artifact with metadata
   */
  addRecordingArtifact(
    metadata: RecordingMetadata,
    transcript?: string,
    blobUrl?: string,
    filePath?: string
  ): Artifact {
    return this.addArtifact({
      type: 'recording',
      name: metadata.name,
      content: transcript,
      blobUrl,
      filePath,
      schoolName: metadata.schoolName,
      tags: metadata.tags || [],
      metadata,
    });
  }

  /**
   * Add a transcript artifact
   */
  addTranscriptArtifact(
    name: string,
    content: string,
    schoolName?: string,
    tags: string[] = []
  ): Artifact {
    return this.addArtifact({
      type: 'transcript',
      name,
      content,
      schoolName,
      tags,
    });
  }

  /**
   * Get artifact by ID
   */
  getArtifact(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  /**
   * Get all artifacts
   */
  getAllArtifacts(): Artifact[] {
    return Array.from(this.artifacts.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get artifacts by school
   */
  getArtifactsBySchool(schoolName: string): Artifact[] {
    return this.getAllArtifacts().filter(a => a.schoolName === schoolName);
  }

  /**
   * Get artifacts by type
   */
  getArtifactsByType(type: Artifact['type']): Artifact[] {
    return this.getAllArtifacts().filter(a => a.type === type);
  }

  /**
   * Update artifact content (e.g., add transcript to recording)
   */
  updateArtifact(id: string, updates: Partial<Artifact>): Artifact | null {
    const artifact = this.artifacts.get(id);
    if (!artifact) return null;

    const updated = { ...artifact, ...updates };
    this.artifacts.set(id, updated);
    this.saveToStorage();

    return updated;
  }

  /**
   * Delete artifact
   */
  deleteArtifact(id: string): boolean {
    const artifact = this.artifacts.get(id);
    if (!artifact) return false;

    // Remove from school if linked
    if (artifact.schoolName) {
      const school = this.getSchoolByName(artifact.schoolName);
      if (school) {
        school.artifacts = school.artifacts.filter(aid => aid !== id);
        this.schools.set(school.id, school);
      }
    }

    // Remove chunks
    this.chunks.delete(id);

    this.artifacts.delete(id);
    this.saveToStorage();

    return true;
  }

  // ==================== SCHOOL MANAGEMENT ====================

  /**
   * Add or update school information
   */
  saveSchool(info: Omit<SchoolInfo, 'id' | 'createdAt' | 'updatedAt' | 'artifacts'>): SchoolInfo {
    const existing = this.getSchoolByName(info.name);

    if (existing) {
      const updated: SchoolInfo = {
        ...existing,
        ...info,
        updatedAt: Date.now(),
      };
      this.schools.set(existing.id, updated);
      this.saveToStorage();
      return updated;
    }

    const newSchool: SchoolInfo = {
      ...info,
      id: `school_${Date.now()}`,
      artifacts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.schools.set(newSchool.id, newSchool);
    this.saveToStorage();

    return newSchool;
  }

  /**
   * Get school by name
   */
  getSchoolByName(name: string): SchoolInfo | undefined {
    return Array.from(this.schools.values()).find(
      s => s.name.toLowerCase() === name.toLowerCase()
    );
  }

  /**
   * Get all schools
   */
  getAllSchools(): SchoolInfo[] {
    return Array.from(this.schools.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Link an artifact to a school
   */
  linkArtifactToSchool(artifactId: string, schoolName: string): void {
    let school = this.getSchoolByName(schoolName);

    if (!school) {
      school = this.saveSchool({ name: schoolName });
    }

    if (!school.artifacts.includes(artifactId)) {
      school.artifacts.push(artifactId);
      this.schools.set(school.id, school);
      this.saveToStorage();
    }
  }

  // ==================== CHUNKING FOR EMBEDDINGS ====================

  /**
   * Chunk artifact content for embedding
   */
  chunkArtifact(
    artifactId: string,
    chunkSize: number = 500,
    overlap: number = 50
  ): ArtifactChunk[] {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact?.content) return [];

    const content = artifact.content;
    const chunks: ArtifactChunk[] = [];
    let startIndex = 0;

    while (startIndex < content.length) {
      const endIndex = Math.min(startIndex + chunkSize, content.length);

      // Try to end at a sentence boundary
      let adjustedEnd = endIndex;
      if (endIndex < content.length) {
        const lastPeriod = content.lastIndexOf('.', endIndex);
        const lastNewline = content.lastIndexOf('\n', endIndex);
        const boundary = Math.max(lastPeriod, lastNewline);

        if (boundary > startIndex + chunkSize * 0.5) {
          adjustedEnd = boundary + 1;
        }
      }

      const chunk: ArtifactChunk = {
        id: `${artifactId}_chunk_${chunks.length}`,
        artifactId,
        content: content.slice(startIndex, adjustedEnd).trim(),
        startIndex,
        endIndex: adjustedEnd,
      };

      if (chunk.content.length > 0) {
        chunks.push(chunk);
      }

      startIndex = adjustedEnd - overlap;
      if (startIndex >= content.length - overlap) break;
    }

    this.chunks.set(artifactId, chunks);
    return chunks;
  }

  /**
   * Get chunks for an artifact
   */
  getChunks(artifactId: string): ArtifactChunk[] {
    return this.chunks.get(artifactId) || [];
  }

  /**
   * Get all chunks for a school's artifacts
   */
  getSchoolChunks(schoolName: string): ArtifactChunk[] {
    const artifacts = this.getArtifactsBySchool(schoolName);
    const allChunks: ArtifactChunk[] = [];

    for (const artifact of artifacts) {
      let chunks = this.chunks.get(artifact.id);
      if (!chunks && artifact.content) {
        chunks = this.chunkArtifact(artifact.id);
      }
      if (chunks) {
        allChunks.push(...chunks);
      }
    }

    return allChunks;
  }

  // ==================== CONTEXT GENERATION ====================

  /**
   * Get all text content for embedding (CV, activities, artifacts)
   */
  getAllEmbeddableContent(): Array<{ id: string; type: string; content: string; source: string }> {
    const content: Array<{ id: string; type: string; content: string; source: string }> = [];

    // Add artifact content
    for (const artifact of this.getAllArtifacts()) {
      if (artifact.content) {
        content.push({
          id: artifact.id,
          type: artifact.type,
          content: artifact.content,
          source: artifact.name,
        });
      }
    }

    return content;
  }

  /**
   * Get school-specific context for system prompt
   */
  getSchoolContext(schoolName: string): string {
    const school = this.getSchoolByName(schoolName);
    if (!school) return '';

    let context = `\n=== ${school.name.toUpperCase()} SPECIFIC INFORMATION ===\n`;

    if (school.mission) {
      context += `\nMission: ${school.mission}\n`;
    }

    if (school.values && school.values.length > 0) {
      context += `\nCore Values: ${school.values.join(', ')}\n`;
    }

    if (school.programs && school.programs.length > 0) {
      context += `\nNotable Programs: ${school.programs.join(', ')}\n`;
    }

    if (school.notes) {
      context += `\nNotes: ${school.notes}\n`;
    }

    // Add artifact content
    const artifacts = this.getArtifactsBySchool(schoolName);
    if (artifacts.length > 0) {
      context += `\n--- Recorded Information ---\n`;
      for (const artifact of artifacts) {
        if (artifact.content) {
          context += `\n[${artifact.name}]:\n${artifact.content.slice(0, 2000)}${artifact.content.length > 2000 ? '...' : ''}\n`;
        }
      }
    }

    return context;
  }

  // ==================== PERSISTENCE ====================

  private loadFromStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      // Load artifacts
      const artifactsJson = localStorage.getItem(ARTIFACTS_KEY);
      if (artifactsJson) {
        const artifactsArray: Artifact[] = JSON.parse(artifactsJson);
        this.artifacts = new Map(artifactsArray.map(a => [a.id, a]));
      }

      // Load schools
      const schoolsJson = localStorage.getItem(SCHOOL_INFO_KEY);
      if (schoolsJson) {
        const schoolsArray: SchoolInfo[] = JSON.parse(schoolsJson);
        this.schools = new Map(schoolsArray.map(s => [s.id, s]));
      }
    } catch (error) {
      console.error('Failed to load artifacts from storage:', error);
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      // Save artifacts (exclude blob URLs as they're runtime only)
      const artifactsArray = Array.from(this.artifacts.values()).map(a => ({
        ...a,
        blobUrl: undefined, // Don't persist blob URLs
      }));
      localStorage.setItem(ARTIFACTS_KEY, JSON.stringify(artifactsArray));

      // Save schools
      const schoolsArray = Array.from(this.schools.values());
      localStorage.setItem(SCHOOL_INFO_KEY, JSON.stringify(schoolsArray));
    } catch (error) {
      console.error('Failed to save artifacts to storage:', error);
    }
  }

  /**
   * Export all data for backup
   */
  exportData(): { artifacts: Artifact[]; schools: SchoolInfo[] } {
    return {
      artifacts: Array.from(this.artifacts.values()),
      schools: Array.from(this.schools.values()),
    };
  }

  /**
   * Import data from backup
   */
  importData(data: { artifacts?: Artifact[]; schools?: SchoolInfo[] }): void {
    if (data.artifacts) {
      for (const artifact of data.artifacts) {
        this.artifacts.set(artifact.id, artifact);
      }
    }

    if (data.schools) {
      for (const school of data.schools) {
        this.schools.set(school.id, school);
      }
    }

    this.saveToStorage();
  }

  /**
   * Clear all data
   */
  clearAll(): void {
    this.artifacts.clear();
    this.schools.clear();
    this.chunks.clear();
    localStorage.removeItem(ARTIFACTS_KEY);
    localStorage.removeItem(SCHOOL_INFO_KEY);
  }
}

// Singleton instance
export const artifactService = new ArtifactService();
