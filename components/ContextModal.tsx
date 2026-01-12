import React, { useState, useEffect, useRef } from 'react';
import { contextService } from '../services/contextService';
import { FileParserService } from '../services/fileParserService';

interface ContextModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ContextModal: React.FC<ContextModalProps> = ({ isOpen, onClose }) => {
  const [cv, setCV] = useState('');
  const [activities, setActivities] = useState('');
  const [saved, setSaved] = useState(false);
  const [isUploadingCV, setIsUploadingCV] = useState(false);
  const [isUploadingActivities, setIsUploadingActivities] = useState(false);

  // Refs for file inputs
  const cvFileInputRef = useRef<HTMLInputElement>(null);
  const activitiesFileInputRef = useRef<HTMLInputElement>(null);

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI;

  // Load existing data when modal opens
  useEffect(() => {
    if (isOpen) {
      setCV(contextService.loadCV() || '');
      setActivities(contextService.loadActivities() || '');
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    contextService.saveCV(cv);
    contextService.saveActivities(activities);
    setSaved(true);
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleClear = () => {
    contextService.clearAll();
    setCV('');
    setActivities('');
    setSaved(false);
  };

  // CV file upload handler
  const handleCVFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingCV(true);
    try {
      // Get API key
      const apiKey = isElectron && window.electronAPI
        ? await window.electronAPI.getApiKey()
        : import.meta.env.VITE_GEMINI_API_KEY;

      if (!apiKey) {
        throw new Error('API key not configured');
      }

      // Parse file
      const parser = new FileParserService(apiKey);
      const text = await parser.parseFile(file);

      // Populate textarea
      setCV(text);
    } catch (error) {
      console.error('CV upload failed:', error);
      alert(`Failed to upload file: ${(error as Error).message}`);
    } finally {
      setIsUploadingCV(false);
      // Reset file input
      if (cvFileInputRef.current) {
        cvFileInputRef.current.value = '';
      }
    }
  };

  // Activities file upload handler
  const handleActivitiesFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingActivities(true);
    try {
      const apiKey = isElectron && window.electronAPI
        ? await window.electronAPI.getApiKey()
        : import.meta.env.VITE_GEMINI_API_KEY;

      if (!apiKey) {
        throw new Error('API key not configured');
      }

      const parser = new FileParserService(apiKey);
      const text = await parser.parseFile(file);
      setActivities(text);
    } catch (error) {
      console.error('Activities upload failed:', error);
      alert(`Failed to upload file: ${(error as Error).message}`);
    } finally {
      setIsUploadingActivities(false);
      if (activitiesFileInputRef.current) {
        activitiesFileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-gray-800 rounded-xl p-6 max-w-2xl w-full border border-gray-700 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Your Background</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <p className="text-gray-400 text-sm mb-6">
          Add your CV and activities to get personalized answers for unexpected questions.
          This information is stored locally and used to tailor AI-generated responses.
        </p>

        <div className="space-y-5">
          {/* CV / Personal Statement */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-300">
                CV / Personal Statement
              </label>
              <div className="flex gap-2">
                <input
                  ref={cvFileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={handleCVFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => cvFileInputRef.current?.click()}
                  disabled={isUploadingCV}
                  className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white transition-colors"
                >
                  {isUploadingCV ? 'Uploading...' : '📄 Upload File'}
                </button>
              </div>
            </div>
            <textarea
              value={cv}
              onChange={(e) => setCV(e.target.value)}
              placeholder="Paste your CV, personal statement, or any relevant background information..."
              className="w-full h-40 px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Include education, research experience, clinical exposure, etc.
            </p>
          </div>

          {/* 15 Activities */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-300">
                15 Activities (AMCAS/AACOMAS)
              </label>
              <div className="flex gap-2">
                <input
                  ref={activitiesFileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={handleActivitiesFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => activitiesFileInputRef.current?.click()}
                  disabled={isUploadingActivities}
                  className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white transition-colors"
                >
                  {isUploadingActivities ? 'Uploading...' : '📄 Upload File'}
                </button>
              </div>
            </div>
            <textarea
              value={activities}
              onChange={(e) => setActivities(e.target.value)}
              placeholder="Paste your most meaningful activities and experiences..."
              className="w-full h-48 px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              The AI will reference these when generating answers to unexpected questions.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={handleClear}
            className="px-4 py-2 text-red-400 hover:text-red-300 text-sm font-medium transition-colors"
          >
            Clear All
          </button>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className={`px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                saved
                  ? 'bg-green-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {saved ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  Saved!
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded text-sm text-blue-200">
          <p className="font-medium mb-1">How this helps:</p>
          <p className="text-blue-300/80">
            When the interviewer asks a question not in your knowledge base, the AI will use your
            CV and activities to generate a personalized answer that references your actual experiences.
          </p>
        </div>
      </div>
    </div>
  );
};
