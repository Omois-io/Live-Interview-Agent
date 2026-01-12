/**
 * Logger Service - Writes logs to file via Electron IPC
 * Falls back to console in browser mode
 */

const isElectron = typeof window !== 'undefined' && window.electronAPI;

export const logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data || '');
    if (isElectron) {
      window.electronAPI?.writeLog('INFO', message, data);
    }
  },

  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data || '');
    if (isElectron) {
      window.electronAPI?.writeLog('WARN', message, data);
    }
  },

  error: (message: string, data?: any) => {
    console.error(`[ERROR] ${message}`, data || '');
    if (isElectron) {
      // Convert Error objects to plain objects for serialization
      const errorData = data instanceof Error
        ? { message: data.message, stack: data.stack, name: data.name }
        : data;
      window.electronAPI?.writeLog('ERROR', message, errorData);
    }
  },

  debug: (message: string, data?: any) => {
    console.debug(`[DEBUG] ${message}`, data || '');
    if (isElectron) {
      window.electronAPI?.writeLog('DEBUG', message, data);
    }
  },

  getLogPath: async (): Promise<string | null> => {
    if (isElectron) {
      return window.electronAPI?.getLogPath() || null;
    }
    return null;
  },

  clearLog: async (): Promise<boolean> => {
    if (isElectron) {
      return window.electronAPI?.clearLog() || false;
    }
    return false;
  }
};
