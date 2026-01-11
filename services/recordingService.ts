/**
 * Recording Service - Captures and saves audio/video sessions
 * Used for recording orientation sessions, interviews, etc.
 */

export interface RecordingMetadata {
  id: string;
  name: string;
  type: 'orientation' | 'interview' | 'practice' | 'other';
  schoolName?: string;
  duration: number; // in seconds
  startTime: number;
  endTime?: number;
  transcript?: string;
  tags?: string[];
}

export interface SavedRecording extends RecordingMetadata {
  audioPath: string;
  transcriptPath?: string;
}

type RecordingCallback = {
  onDataAvailable?: (blob: Blob) => void;
  onStop?: (blob: Blob, metadata: RecordingMetadata) => void;
  onError?: (error: Error) => void;
};

export class RecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording: boolean = false;
  private startTime: number = 0;
  private currentMetadata: Partial<RecordingMetadata> = {};
  private callbacks: RecordingCallback = {};

  /**
   * Start recording from the given audio streams
   */
  startRecording(
    streams: { system?: MediaStream; mic?: MediaStream },
    metadata: Partial<RecordingMetadata>,
    callbacks: RecordingCallback
  ): boolean {
    if (this.isRecording) {
      console.warn('Recording already in progress');
      return false;
    }

    // Combine streams if both available
    const combinedStream = this.combineStreams(streams);
    if (!combinedStream) {
      callbacks.onError?.(new Error('No audio stream available'));
      return false;
    }

    this.audioChunks = [];
    this.callbacks = callbacks;
    this.currentMetadata = {
      ...metadata,
      id: Date.now().toString(),
      startTime: Date.now(),
    };

    try {
      // Use webm format with opus codec for good quality/size ratio
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          callbacks.onDataAvailable?.(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.audioChunks, { type: mimeType });
        const duration = (Date.now() - this.startTime) / 1000;

        const finalMetadata: RecordingMetadata = {
          id: this.currentMetadata.id || Date.now().toString(),
          name: this.currentMetadata.name || `Recording ${new Date().toLocaleDateString()}`,
          type: this.currentMetadata.type || 'other',
          schoolName: this.currentMetadata.schoolName,
          duration,
          startTime: this.startTime,
          endTime: Date.now(),
          tags: this.currentMetadata.tags,
        };

        callbacks.onStop?.(blob, finalMetadata);
        this.isRecording = false;
      };

      this.mediaRecorder.onerror = (event: Event) => {
        const error = (event as ErrorEvent).error || new Error('Recording error');
        callbacks.onError?.(error);
        this.isRecording = false;
      };

      // Start recording with 1-second chunks for incremental saving
      this.mediaRecorder.start(1000);
      this.startTime = Date.now();
      this.isRecording = true;

      console.log('Recording started with format:', mimeType);
      return true;
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error : new Error('Failed to start recording'));
      return false;
    }
  }

  /**
   * Stop the current recording
   */
  stopRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
    }
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Get recording duration in seconds
   */
  getRecordingDuration(): number {
    if (!this.isRecording) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Combine multiple audio streams into one
   */
  private combineStreams(streams: { system?: MediaStream; mic?: MediaStream }): MediaStream | null {
    const tracks: MediaStreamTrack[] = [];

    if (streams.system) {
      streams.system.getAudioTracks().forEach(track => tracks.push(track));
    }
    if (streams.mic) {
      streams.mic.getAudioTracks().forEach(track => tracks.push(track));
    }

    if (tracks.length === 0) return null;

    // If only one stream, return it directly
    if (tracks.length === 1) {
      return new MediaStream(tracks);
    }

    // For multiple streams, we need to mix them using AudioContext
    // For now, return just the combined tracks (browser will handle mixing)
    return new MediaStream(tracks);
  }

  /**
   * Get supported MIME type for recording
   */
  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'audio/webm'; // Fallback
  }

  /**
   * Save recording blob to file system (Electron only)
   */
  async saveToFile(
    blob: Blob,
    metadata: RecordingMetadata,
    directory?: string
  ): Promise<string | null> {
    if (!window.electronAPI) {
      console.warn('File saving only available in Electron');
      return null;
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Generate filename
      const sanitizedName = (metadata.name || 'recording')
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase();
      const timestamp = new Date(metadata.startTime).toISOString().replace(/[:.]/g, '-');
      const extension = blob.type.includes('webm') ? 'webm' : 'ogg';
      const filename = `${sanitizedName}_${timestamp}.${extension}`;

      // Save via Electron IPC
      const filePath = await window.electronAPI.saveRecording({
        data: Array.from(uint8Array),
        filename,
        directory: directory || 'recordings',
        metadata,
      });

      console.log('Recording saved to:', filePath);
      return filePath;
    } catch (error) {
      console.error('Failed to save recording:', error);
      return null;
    }
  }

  /**
   * Download recording in browser
   */
  downloadRecording(blob: Blob, metadata: RecordingMetadata): void {
    const extension = blob.type.includes('webm') ? 'webm' : 'ogg';
    const sanitizedName = (metadata.name || 'recording')
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    const filename = `${sanitizedName}_${metadata.id}.${extension}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Singleton instance
export const recordingService = new RecordingService();
