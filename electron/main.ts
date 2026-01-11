import { app, BrowserWindow, ipcMain, screen, desktopCapturer, dialog } from 'electron';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Get recordings directory
const getRecordingsPath = () => path.join(app.getPath('userData'), 'recordings');
const getArtifactsPath = () => path.join(app.getPath('userData'), 'artifacts');

// Ensure directories exist
function ensureDirectories(): void {
  const dirs = [getRecordingsPath(), getArtifactsPath()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

let mainWindow: BrowserWindow | null = null;

// API Key storage
const getConfigPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig(): { apiKey?: string } {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return {};
}

function saveConfig(config: { apiKey?: string }): void {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}
let systemAudioProcess: ChildProcessWithoutNullStreams | null = null;

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Get available audio sources (platform-specific)
async function getAudioSources(): Promise<{ id: string; name: string; type: 'monitor' | 'input' | 'screen' }[]> {
  if (isWindows) {
    // On Windows, use desktopCapturer to get screen sources (which include audio)
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: false
      });

      return sources.map(source => ({
        id: source.id,
        name: source.name,
        type: 'screen' as const
      }));
    } catch (error) {
      console.error('Failed to get desktop sources:', error);
      return [];
    }
  } else if (isLinux) {
    // On Linux, use PulseAudio
    try {
      const output = execSync('pactl list sources short', { encoding: 'utf-8' });
      const sources: { id: string; name: string; type: 'monitor' | 'input' }[] = [];

      output.split('\n').forEach(line => {
        const parts = line.trim().split('\t');
        if (parts.length >= 2) {
          const id = parts[1];
          const isMonitor = id.includes('.monitor');
          sources.push({
            id,
            name: id,
            type: isMonitor ? 'monitor' : 'input'
          });
        }
      });

      return sources;
    } catch (error) {
      console.error('Failed to get PulseAudio sources:', error);
      return [];
    }
  }

  return [];
}

// Start capturing system audio (Linux only - Windows uses renderer-side capture)
function startSystemAudioCapture(sourceId: string): boolean {
  if (!isLinux) {
    // On Windows, audio capture is handled in the renderer via getUserMedia
    console.log('Windows system audio: handled in renderer with sourceId:', sourceId);
    return true;
  }

  if (systemAudioProcess) {
    systemAudioProcess.kill();
  }

  try {
    // Use parec to capture audio in raw PCM format
    // 16kHz, mono, 16-bit signed little-endian (required by Gemini)
    systemAudioProcess = spawn('parec', [
      '--rate=16000',
      '--channels=1',
      '--format=s16le',
      '-d', sourceId
    ]);

    systemAudioProcess.stdout.on('data', (chunk: Buffer) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system-audio-data', chunk);
      }
    });

    systemAudioProcess.stderr.on('data', (data: Buffer) => {
      console.error('parec stderr:', data.toString());
    });

    systemAudioProcess.on('error', (error) => {
      console.error('parec error:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('audio-capture-error', error.message);
      }
    });

    systemAudioProcess.on('close', (code) => {
      console.log('parec process exited with code:', code);
      systemAudioProcess = null;
    });

    return true;
  } catch (error) {
    console.error('Failed to start audio capture:', error);
    return false;
  }
}

function stopSystemAudioCapture(): void {
  if (systemAudioProcess) {
    systemAudioProcess.kill();
    systemAudioProcess = null;
  }
}

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 600,
    height: 800,
    x: width - 620,
    y: 20,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Allow clicking through fully transparent regions
  mainWindow.setIgnoreMouseEvents(false);

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopSystemAudioCapture();
  });
}

// IPC Handlers
ipcMain.handle('get-audio-sources', async () => {
  return await getAudioSources();
});

ipcMain.handle('start-system-audio', (_event, sourceId: string) => {
  return startSystemAudioCapture(sourceId);
});

ipcMain.handle('stop-system-audio', () => {
  stopSystemAudioCapture();
  return true;
});

ipcMain.handle('get-api-key', () => {
  // First check saved config, then fall back to env var
  const config = loadConfig();
  return config.apiKey || process.env.GEMINI_API_KEY || '';
});

ipcMain.handle('set-api-key', (_event, apiKey: string) => {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
  return true;
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

ipcMain.handle('set-always-on-top', (_event, value: boolean) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(value);
    return true;
  }
  return false;
});

ipcMain.handle('set-window-opacity', (_event, opacity: number) => {
  if (mainWindow) {
    mainWindow.setOpacity(opacity);
    return true;
  }
  return false;
});

ipcMain.handle('set-click-through', (_event, enable: boolean) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(enable, { forward: true });
    return true;
  }
  return false;
});

// Recording handlers
ipcMain.handle('save-recording', async (_event, options: {
  data: number[];
  filename: string;
  directory?: string;
  metadata?: any;
}) => {
  ensureDirectories();

  const { data, filename, directory, metadata } = options;
  const targetDir = directory === 'artifacts'
    ? getArtifactsPath()
    : getRecordingsPath();

  const filePath = path.join(targetDir, filename);

  try {
    // Save audio file
    const buffer = Buffer.from(data);
    fs.writeFileSync(filePath, buffer);

    // Save metadata alongside
    if (metadata) {
      const metadataPath = filePath.replace(/\.[^.]+$/, '.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    }

    console.log('Recording saved to:', filePath);
    return filePath;
  } catch (error) {
    console.error('Failed to save recording:', error);
    throw error;
  }
});

ipcMain.handle('get-recordings-path', () => {
  ensureDirectories();
  return getRecordingsPath();
});

ipcMain.handle('list-recordings', () => {
  ensureDirectories();
  const recordingsDir = getRecordingsPath();

  try {
    const files = fs.readdirSync(recordingsDir);
    const recordings: Array<{ filename: string; path: string; metadata?: any }> = [];

    for (const file of files) {
      if (file.endsWith('.webm') || file.endsWith('.ogg') || file.endsWith('.mp3')) {
        const filePath = path.join(recordingsDir, file);
        const metadataPath = filePath.replace(/\.[^.]+$/, '.json');

        let metadata;
        if (fs.existsSync(metadataPath)) {
          try {
            metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
          } catch (e) {
            console.warn('Failed to parse metadata:', metadataPath);
          }
        }

        recordings.push({
          filename: file,
          path: filePath,
          metadata,
        });
      }
    }

    return recordings;
  } catch (error) {
    console.error('Failed to list recordings:', error);
    return [];
  }
});

ipcMain.handle('delete-recording', (_event, filename: string) => {
  const filePath = path.join(getRecordingsPath(), filename);
  const metadataPath = filePath.replace(/\.[^.]+$/, '.json');

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }
    return true;
  } catch (error) {
    console.error('Failed to delete recording:', error);
    return false;
  }
});

ipcMain.handle('export-recording', async (_event, filename: string) => {
  const sourcePath = path.join(getRecordingsPath(), filename);

  if (!fs.existsSync(sourcePath)) {
    throw new Error('Recording file not found');
  }

  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: filename,
    filters: [
      { name: 'Audio Files', extensions: ['webm', 'ogg', 'mp3'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  fs.copyFileSync(sourcePath, result.filePath);
  return result.filePath;
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopSystemAudioCapture();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopSystemAudioCapture();
});
