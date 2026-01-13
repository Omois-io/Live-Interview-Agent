import React, { useState, useRef } from 'react';
import { KnowledgeItem } from '../types';
import { KnowledgeService } from '../services/knowledgeService';
import { logger } from '../services/logger';

interface ContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  knowledgeItems: KnowledgeItem[];
  onItemsUpdate: (items: KnowledgeItem[]) => void;
}

export const ContextModal: React.FC<ContextModalProps> = ({
  isOpen,
  onClose,
  knowledgeItems,
  onItemsUpdate
}) => {
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI;

  // Get API key
  const getApiKey = async (): Promise<string> => {
    if (isElectron && window.electronAPI) {
      return await window.electronAPI.getApiKey();
    }
    return import.meta.env.VITE_GEMINI_API_KEY || '';
  };

  // Process file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setProcessingStatus('Reading file...');

    try {
      const apiKey = await getApiKey();
      if (!apiKey) throw new Error('API key not configured');

      const knowledgeService = new KnowledgeService(apiKey);

      // Read file as base64
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64String = (reader.result as string).split(',')[1];

          setProcessingStatus('Parsing document with AI...');
          logger.info(`[ContextModal] Parsing file: ${file.name}`);

          // Parse document into chunks
          const items = await knowledgeService.parseDocument(base64String, file.type);

          setProcessingStatus(`Embedding ${items.length} chunks...`);
          logger.info(`[ContextModal] Parsed ${items.length} chunks, now embedding...`);

          // Embed each chunk
          const { embedded, failed } = await knowledgeService.embedItems(items);

          // Add all items (both embedded and failed) so user can see them
          const allItems = [...embedded, ...failed];
          const newItems = [...knowledgeItems, ...allItems];
          onItemsUpdate(newItems);

          // Save to localStorage
          localStorage.setItem('interview_knowledge_items', JSON.stringify(newItems));

          setProcessingStatus('');
          logger.info(`[ContextModal] Successfully processed ${embedded.length} chunks, ${failed.length} failed`);

          // Show detailed feedback
          if (failed.length > 0) {
            alert(`Parsed ${items.length} items.\n\n✓ ${embedded.length} embedded (searchable)\n✗ ${failed.length} failed embedding (visible but not searchable)\n\nFailed items: ${failed.map(f => f.title).join(', ')}`);
          } else {
            alert(`Successfully processed ${embedded.length} experience items!`);
          }
        } catch (err) {
          logger.error('[ContextModal] Processing failed:', err);
          alert(`Failed to process file: ${(err as Error).message}`);
        } finally {
          setIsProcessing(false);
          setProcessingStatus('');
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      logger.error('[ContextModal] File upload failed:', err);
      alert(`Failed to upload file: ${(err as Error).message}`);
      setIsProcessing(false);
      setProcessingStatus('');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Process pasted text
  const handleProcessText = async () => {
    if (!text.trim()) {
      alert('Please paste some text first');
      return;
    }

    setIsProcessing(true);
    setProcessingStatus('Parsing text with AI...');

    try {
      const apiKey = await getApiKey();
      if (!apiKey) throw new Error('API key not configured');

      const knowledgeService = new KnowledgeService(apiKey);

      logger.info('[ContextModal] Parsing pasted text...');

      // Parse text into chunks
      const items = await knowledgeService.parseText(text);

      setProcessingStatus(`Embedding ${items.length} chunks...`);
      logger.info(`[ContextModal] Parsed ${items.length} chunks, now embedding...`);

      // Embed each chunk
      const { embedded, failed } = await knowledgeService.embedItems(items);

      // Add all items (both embedded and failed) so user can see them
      const allItems = [...embedded, ...failed];
      const newItems = [...knowledgeItems, ...allItems];
      onItemsUpdate(newItems);

      // Save to localStorage
      localStorage.setItem('interview_knowledge_items', JSON.stringify(newItems));

      // Clear text input
      setText('');

      logger.info(`[ContextModal] Successfully processed ${embedded.length} chunks, ${failed.length} failed`);

      // Show detailed feedback
      if (failed.length > 0) {
        alert(`Parsed ${items.length} items.\n\n✓ ${embedded.length} embedded (searchable)\n✗ ${failed.length} failed embedding (visible but not searchable)\n\nFailed items: ${failed.map(f => f.title).join(', ')}`);
      } else {
        alert(`Successfully processed ${embedded.length} experience items!`);
      }
    } catch (err) {
      logger.error('[ContextModal] Text processing failed:', err);
      alert(`Failed to process text: ${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Clear all items
  const handleClear = () => {
    if (confirm('Clear all knowledge items?')) {
      onItemsUpdate([]);
      localStorage.removeItem('interview_knowledge_items');
      setText('');
      logger.info('[ContextModal] Cleared all knowledge items');
    }
  };

  // Delete single item
  const handleDeleteItem = (id: string) => {
    const newItems = knowledgeItems.filter(item => item.id !== id);
    onItemsUpdate(newItems);
    localStorage.setItem('interview_knowledge_items', JSON.stringify(newItems));
  };

  // Get type badge color
  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'experience': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'activity': return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'education': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-xl p-6 max-w-3xl w-full border border-gray-700 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Knowledge Base</h2>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Upload Section */}
        <div className="mb-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <p className="text-sm text-gray-400 mb-3">Upload your CV, resume, or activities list to create searchable knowledge chunks.</p>

          {/* File Upload */}
          <div className="mb-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.docx"
              onChange={handleFileUpload}
              disabled={isProcessing}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="w-full py-3 px-4 border-2 border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? processingStatus : '📄 Click to upload PDF, TXT, or DOCX'}
            </button>
          </div>

          {/* OR divider */}
          <div className="flex items-center gap-3 my-3">
            <div className="flex-1 h-px bg-gray-700"></div>
            <span className="text-xs text-gray-500 uppercase">or paste text</span>
            <div className="flex-1 h-px bg-gray-700"></div>
          </div>

          {/* Text Input */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your CV, resume, or activities text here..."
            disabled={isProcessing}
            className="w-full h-32 px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none text-sm disabled:opacity-50"
          />

          {/* Process Button */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleProcessText}
              disabled={isProcessing || !text.trim()}
              className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {processingStatus}
                </span>
              ) : 'Process Text'}
            </button>
            {knowledgeItems.length > 0 && (
              <button
                onClick={handleClear}
                disabled={isProcessing}
                className="py-2 px-4 text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg transition-colors disabled:opacity-50"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Knowledge Items List */}
        <div className="flex-1 overflow-y-auto">
          {knowledgeItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-lg mb-2">No knowledge items yet</p>
              <p className="text-sm">Upload a document or paste text to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-400 mb-2">
                {knowledgeItems.length} knowledge chunks
                <span className="text-green-400 ml-2">
                  ({knowledgeItems.filter(i => i.embedding).length} searchable)
                </span>
                {knowledgeItems.filter(i => !i.embedding).length > 0 && (
                  <span className="text-red-400 ml-1">
                    ({knowledgeItems.filter(i => !i.embedding).length} not embedded)
                  </span>
                )}
              </p>
              {knowledgeItems.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-gray-900/50 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium text-blue-400 truncate">{item.title}</h4>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${getTypeBadgeColor(item.metadata.type)}`}>
                          {item.metadata.type}
                        </span>
                        {/* Embedding status badge */}
                        {item.embedding ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
                            embedded
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30" title="Failed to embed - not searchable">
                            not embedded
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 line-clamp-3">{item.content}</p>
                      {item.metadata.skills && item.metadata.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.metadata.skills.slice(0, 5).map((skill, i) => (
                            <span key={i} className="text-[9px] px-1 py-0.5 bg-gray-700 text-gray-300 rounded">
                              {skill}
                            </span>
                          ))}
                          {item.metadata.skills.length > 5 && (
                            <span className="text-[9px] text-gray-500">+{item.metadata.skills.length - 5} more</span>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="text-gray-500 hover:text-red-400 transition-colors p-1"
                      title="Delete item"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded text-sm text-blue-200">
          <p className="font-medium mb-1">How this works:</p>
          <p className="text-blue-300/80 text-xs">
            Your document is parsed into separate "knowledge chunks" (experiences, activities, education).
            During the interview, when a question is asked, the AI searches these chunks to find relevant
            information and uses it to generate personalized answers.
          </p>
        </div>
      </div>
    </div>
  );
};
