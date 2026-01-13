/**
 * Logger Service - Writes logs to file via Electron IPC
 * Falls back to console in browser mode
 */

const isElectron = typeof window !== 'undefined' && window.electronAPI;

export const logger = {
  info: (message: string, data?: any) => {
    console.log(message, data !== undefined ? data : '');
    if (isElectron) {
      window.electronAPI?.writeLog('INFO', message, data);
    }
  },

  warn: (message: string, data?: any) => {
    console.warn(message, data !== undefined ? data : '');
    if (isElectron) {
      window.electronAPI?.writeLog('WARN', message, data);
    }
  },

  error: (message: string, data?: any) => {
    console.error(message, data !== undefined ? data : '');
    if (isElectron) {
      // Convert Error objects to plain objects for serialization
      const errorData = data instanceof Error
        ? { message: data.message, stack: data.stack, name: data.name }
        : data;
      window.electronAPI?.writeLog('ERROR', message, errorData);
    }
  },

  debug: (message: string, data?: any) => {
    // Debug only in dev mode console, skip file logging
    if (process.env.NODE_ENV === 'development') {
      console.debug(message, data !== undefined ? data : '');
    }
    // Don't write DEBUG to file - too noisy
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
