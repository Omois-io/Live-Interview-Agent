import React from 'react';

const isElectron = !!window.electronAPI;

interface ApiKeyModalProps {
  onComplete: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onComplete }) => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [apiKey, setApiKey] = React.useState('');

  const handleSubmitKey = async () => {
    if (!apiKey.trim()) {
      setError('Please enter your API key');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      if (isElectron && window.electronAPI) {
        await window.electronAPI.setApiKey(apiKey.trim());
        onComplete();
      }
    } catch (e: any) {
      setError('Failed to save API key: ' + (e.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async () => {
    setError(null);
    setLoading(true);
    try {
      if (window.aistudio && window.aistudio.openSelectKey) {
        await window.aistudio.openSelectKey();
        onComplete();
      } else {
        console.warn("window.aistudio not found, proceeding with env key");
        onComplete();
      }
    } catch (e: any) {
      if (e.message && e.message.includes("Requested entity was not found")) {
        setError("Key not found. Please try selecting again.");
      } else {
        setError("Failed to select key.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Electron: Show text input for API key
  if (isElectron) {
    return (
      <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl p-8 max-w-md w-full border border-gray-700 shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-4">Interview HUD Setup</h2>
          <p className="text-gray-300 mb-6">
            Enter your Gemini API key to use the real-time audio analysis feature.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Gemini API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitKey()}
              />
            </div>

            <button
              onClick={handleSubmitKey}
              disabled={loading || !apiKey.trim()}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <span>Save & Continue</span>
              )}
            </button>

            <p className="text-xs text-center text-gray-500 mt-2">
              Get your API key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google AI Studio</a>
            </p>
            <p className="text-xs text-center text-gray-600">
              Your key is saved locally and never sent anywhere except Google's API.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Web: Use the existing select flow
  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl p-8 max-w-md w-full border border-gray-700 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-4">Interview HUD Setup</h2>
        <p className="text-gray-300 mb-6">
          To use the Gemini Live API for real-time audio analysis, you need to select a paid API key.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={handleSelect}
            disabled={loading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <span>Select API Key</span>
            )}
          </button>

          <p className="text-xs text-center text-gray-500 mt-4">
            See <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Billing Documentation</a> for more details.
          </p>
        </div>
      </div>
    </div>
  );
};
