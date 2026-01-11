interface AudioSource {
  id: string;
  name: string;
  type: 'monitor' | 'input' | 'screen';
}

interface RecordingOptions {
  data: number[];
  filename: string;
  directory?: string;
  metadata?: any;
}

interface SavedRecording {
  filename: string;
  path: string;
  metadata?: any;
}

interface ElectronAPI {
  // Audio capture
  getAudioSources: () => Promise<AudioSource[]>;
  startSystemAudio: (sourceId: string) => Promise<boolean>;
  stopSystemAudio: () => Promise<boolean>;
  onSystemAudioData: (callback: (data: Buffer) => void) => void;
  onAudioCaptureError: (callback: (error: string) => void) => void;
  removeSystemAudioListener: () => void;

  // Recording
  saveRecording: (options: RecordingOptions) => Promise<string>;
  getRecordingsPath: () => Promise<string>;
  listRecordings: () => Promise<SavedRecording[]>;
  deleteRecording: (filename: string) => Promise<boolean>;
  exportRecording: (filename: string) => Promise<string | null>;

  // API key & config
  getApiKey: () => Promise<string>;
  setApiKey: (apiKey: string) => Promise<boolean>;

  // Window control
  setAlwaysOnTop: (value: boolean) => Promise<boolean>;
  setWindowOpacity: (opacity: number) => Promise<boolean>;
  setClickThrough: (enable: boolean) => Promise<boolean>;

  // Platform info
  platform: string;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey?: () => Promise<boolean>;
      selectApiKey?: () => Promise<void>;
      openSelectKey?: () => Promise<void>;
    };
    electronAPI?: ElectronAPI;
  }
}

export {};
