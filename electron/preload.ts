import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the exposed API
export interface AudioSource {
  id: string;
  name: string;
  type: 'monitor' | 'input' | 'screen';
}

export interface RecordingOptions {
  data: number[];
  filename: string;
  directory?: string;
  metadata?: any;
}

export interface SavedRecording {
  filename: string;
  path: string;
  metadata?: any;
}

export interface ElectronAPI {
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

  // API key
  getApiKey: () => Promise<string>;
  setApiKey: (apiKey: string) => Promise<boolean>;

  // Window control
  setAlwaysOnTop: (value: boolean) => Promise<boolean>;
  setWindowOpacity: (opacity: number) => Promise<boolean>;
  setClickThrough: (enable: boolean) => Promise<boolean>;

  // Logging
  writeLog: (level: string, message: string, data?: any) => Promise<boolean>;
  getLogPath: () => Promise<string>;
  clearLog: () => Promise<boolean>;

  // Platform info
  platform: string;
}

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Audio capture
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
  startSystemAudio: (sourceId: string) => ipcRenderer.invoke('start-system-audio', sourceId),
  stopSystemAudio: () => ipcRenderer.invoke('stop-system-audio'),
  onSystemAudioData: (callback: (data: Buffer) => void) => {
    ipcRenderer.on('system-audio-data', (_event, data) => callback(data));
  },
  onAudioCaptureError: (callback: (error: string) => void) => {
    ipcRenderer.on('audio-capture-error', (_event, error) => callback(error));
  },
  removeSystemAudioListener: () => {
    ipcRenderer.removeAllListeners('system-audio-data');
    ipcRenderer.removeAllListeners('audio-capture-error');
  },

  // Recording
  saveRecording: (options: RecordingOptions) => ipcRenderer.invoke('save-recording', options),
  getRecordingsPath: () => ipcRenderer.invoke('get-recordings-path'),
  listRecordings: () => ipcRenderer.invoke('list-recordings'),
  deleteRecording: (filename: string) => ipcRenderer.invoke('delete-recording', filename),
  exportRecording: (filename: string) => ipcRenderer.invoke('export-recording', filename),

  // API key
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (apiKey: string) => ipcRenderer.invoke('set-api-key', apiKey),

  // Window control
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('set-always-on-top', value),
  setWindowOpacity: (opacity: number) => ipcRenderer.invoke('set-window-opacity', opacity),
  setClickThrough: (enable: boolean) => ipcRenderer.invoke('set-click-through', enable),

  // Logging
  writeLog: (level: string, message: string, data?: any) => ipcRenderer.invoke('write-log', level, message, data),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  clearLog: () => ipcRenderer.invoke('clear-log'),

  // Platform info
  platform: process.platform
} as ElectronAPI);
