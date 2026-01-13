import React, { useState, useEffect, useRef } from 'react';
import { EmbeddedChunk, EmbeddingMatch } from '../services/embeddingService';
import { KnowledgeItem, SuggestionItem } from '../types';
import { ThoroughModel } from '../services/thoroughAnswerService';

interface LiveAnswerPanelProps {
  // Current question being answered
  question: string;
  // Streaming answer text
  streamingAnswer: string;
  // Whether currently streaming
  isStreaming: boolean;
  // Matched Q&A items
  qaMatches: EmbeddingMatch[];
  // Retrieved context chunks (from embedding service)
  contextChunks: EmbeddedChunk[];
  // RAG chunks actually sent to Gemini (from knowledge service)
  ragChunks?: KnowledgeItem[];
  // Final preset answer (if matched)
  presetAnswer?: string;
  // Callback when user wants to use a different chunk
  onUseChunk?: (chunk: EmbeddedChunk) => void;
  // Q&A history (past suggestions)
  suggestions?: SuggestionItem[];
  // Callback to scroll to a specific suggestion
  onScrollToSuggestion?: (index: number) => void;
  // Callback to clear all history
  onClearHistory?: () => void;
  // Refs for suggestion elements (for scrolling)
  suggestionRefs?: React.MutableRefObject<(HTMLDivElement | null)[]>;
  // Thorough answer (from better model)
  thoroughAnswer?: string;
  // Whether thorough answer is being generated
  isThoroughGenerating?: boolean;
  // Model used for thorough answer
  thoroughModel?: ThoroughModel;
  // Error from thorough answer generation
  thoroughError?: string | null;
}

export function LiveAnswerPanel({
  question,
  streamingAnswer,
  isStreaming,
  qaMatches,
  contextChunks,
  ragChunks = [],
  presetAnswer,
  onUseChunk,
  suggestions = [],
  onScrollToSuggestion,
  onClearHistory,
  suggestionRefs,
  thoroughAnswer = '',
  isThoroughGenerating = false,
  thoroughModel,
  thoroughError,
}: LiveAnswerPanelProps) {
  const [showChunks, setShowChunks] = useState(false);  // Hide left panel by default
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [expandedChunkIndex, setExpandedChunkIndex] = useState<number | null>(null);
  const answerEndRef = useRef<HTMLDivElement>(null);

  // Toggle between Live and Thorough views
  const [currentAnswerView, setCurrentAnswerView] = useState<'live' | 'thorough'>('live');

  // Which history item is being viewed (null = current/live question)
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);

  // Auto-scroll to bottom of streaming answer
  useEffect(() => {
    answerEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamingAnswer]);

  const getChunkTypeIcon = (type: EmbeddedChunk['type']) => {
    switch (type) {
      case 'cv':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        );
      case 'activities':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        );
      case 'artifact':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getChunkTypeColor = (type: EmbeddedChunk['type']) => {
    switch (type) {
      case 'cv':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'activities':
        return 'text-green-400 bg-green-500/10 border-green-500/30';
      case 'artifact':
        return 'text-purple-400 bg-purple-500/10 border-purple-500/30';
      default:
        return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900/95 backdrop-blur-xl rounded-xl border border-gray-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Interview Assistant</h2>
          {suggestions.length > 0 && (
            <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{suggestions.length}</span>
          )}
        </div>

        {/* Q&A History Quick-Access Buttons */}
        <div className="flex items-center gap-2">
          {suggestions.length > 0 && (
            <div className="flex items-center gap-1">
              {/* Current/Live button */}
              <button
                onClick={() => setSelectedHistoryIndex(null)}
                className={`px-2 h-5 text-[10px] font-bold rounded transition-colors ${
                  selectedHistoryIndex === null
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'
                }`}
                title="Current question"
              >
                Live
              </button>
              {suggestions.map((item, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedHistoryIndex(selectedHistoryIndex === index ? null : index)}
                  className={`w-5 h-5 text-[10px] font-bold rounded transition-colors ${
                    selectedHistoryIndex === index
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'
                  }`}
                  title={`Q${index + 1}${item.thoroughAnswer ? ' (has thorough)' : ''}`}
                >
                  {index + 1}
                </button>
              ))}
              <button
                onClick={() => onClearHistory?.()}
                className="ml-1 px-2 py-0.5 text-[10px] font-bold text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                title="Clear all Q&A history"
              >
                ×
              </button>
            </div>
          )}
          <button
            onClick={() => setShowChunks(!showChunks)}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            {showChunks ? 'Hide Context' : 'Show Context'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Context Chunks Panel */}
        {showChunks && (contextChunks.length > 0 || qaMatches.length > 0) && (
          <div className="w-72 border-r border-gray-700/50 flex flex-col bg-gray-900/50">
            <div className="px-3 py-2 border-b border-gray-700/50">
              <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Retrieved Context
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
              {/* Q&A Matches */}
              {qaMatches.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-yellow-500/80 uppercase tracking-widest px-1">
                    Matched Questions
                  </span>
                  {qaMatches.map((match) => (
                    <div
                      key={match.id}
                      className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 cursor-pointer hover:bg-yellow-500/20 transition-colors"
                    >
                      <p className="text-[10px] text-yellow-200 font-medium truncate">
                        {match.question}
                      </p>
                      <p className="text-[9px] text-yellow-500/60 mt-0.5">
                        Score: {(match.score * 100).toFixed(0)}%
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Context Chunks */}
              {contextChunks.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest px-1">
                    Relevant Context
                  </span>
                  {contextChunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      onClick={() => {
                        setSelectedChunkId(chunk.id);
                        onUseChunk?.(chunk);
                      }}
                      className={`p-2 rounded-lg border cursor-pointer transition-all ${
                        selectedChunkId === chunk.id
                          ? 'ring-2 ring-blue-500/50 ' + getChunkTypeColor(chunk.type)
                          : getChunkTypeColor(chunk.type) + ' hover:opacity-80'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {getChunkTypeIcon(chunk.type)}
                        <span className="text-[9px] font-bold uppercase tracking-wider">
                          {chunk.source}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-300 line-clamp-3 leading-relaxed">
                        {chunk.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Answer Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Question Display */}
          <div className={`px-4 py-3 border-b border-gray-700/50 ${
            selectedHistoryIndex !== null
              ? 'bg-gradient-to-r from-blue-600/20 to-transparent'
              : 'bg-gradient-to-r from-blue-500/10 to-transparent'
          }`}>
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest block mb-1">
              {selectedHistoryIndex !== null ? `Question ${selectedHistoryIndex + 1}` : 'Detected Question'}
            </span>
            <h2 className="text-lg font-bold text-white leading-snug">
              {selectedHistoryIndex !== null && suggestions[selectedHistoryIndex]
                ? suggestions[selectedHistoryIndex].question
                : (question || 'Listening for question...')}
            </h2>
          </div>

          {/* Answer Display */}
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {/* RAG Chunk Boxes - Always visible at top when chunks exist */}
            {ragChunks.length > 0 && (
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-700/30">
                <span className="text-[9px] text-gray-500 uppercase tracking-widest">RAG Context</span>
                <div className="flex items-center gap-1">
                  {ragChunks.slice(0, 5).map((chunk, index) => (
                    <button
                      key={chunk.id}
                      onClick={() => setExpandedChunkIndex(expandedChunkIndex === index ? null : index)}
                      className={`px-2 py-1 text-[10px] font-medium rounded border transition-all ${
                        expandedChunkIndex === index
                          ? 'bg-blue-500/30 border-blue-400 text-blue-300'
                          : 'bg-gray-700/50 border-gray-600 text-gray-400 hover:bg-gray-600/50 hover:text-gray-300'
                      }`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Expanded Chunk View - Global position */}
            {expandedChunkIndex !== null && ragChunks[expandedChunkIndex] && (
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">
                    Chunk {expandedChunkIndex + 1}: {ragChunks[expandedChunkIndex].title}
                  </span>
                  <button
                    onClick={() => setExpandedChunkIndex(null)}
                    className="text-gray-400 hover:text-white text-xs"
                  >
                    ×
                  </button>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {ragChunks[expandedChunkIndex].content}
                </p>
              </div>
            )}

            {/* Answer Toggle Buttons */}
            {(() => {
              // Determine what data to show based on selection
              const selectedItem = selectedHistoryIndex !== null ? suggestions[selectedHistoryIndex] : null;
              const showLiveAnswer = selectedItem
                ? (selectedItem.liveAnswer || (selectedItem as any).answer || '')
                : (presetAnswer || streamingAnswer);
              const showThoroughAnswer = selectedItem ? selectedItem.thoroughAnswer : thoroughAnswer;
              const hasAnyAnswer = showLiveAnswer || showThoroughAnswer || isThoroughGenerating;

              return hasAnyAnswer ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentAnswerView('live')}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-l transition-colors ${
                          currentAnswerView === 'live'
                            ? 'bg-green-500/30 text-green-300 border border-green-500/50'
                            : 'bg-gray-700/50 text-gray-400 border border-gray-600 hover:bg-gray-600/50'
                        }`}
                      >
                        Live
                        {selectedHistoryIndex === null && isStreaming && (
                          <span className="ml-1 inline-block w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                        )}
                      </button>
                      <button
                        onClick={() => setCurrentAnswerView('thorough')}
                        disabled={!showThoroughAnswer && !isThoroughGenerating}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-r transition-colors ${
                          currentAnswerView === 'thorough'
                            ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                            : showThoroughAnswer || isThoroughGenerating
                              ? 'bg-gray-700/50 text-gray-400 border border-gray-600 hover:bg-gray-600/50'
                              : 'bg-gray-800/50 text-gray-600 border border-gray-700 cursor-not-allowed'
                        }`}
                      >
                        Thorough
                        {selectedHistoryIndex === null && isThoroughGenerating && (
                          <span className="ml-1 inline-block w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" />
                        )}
                        {selectedHistoryIndex === null && thoroughError && (
                          <span className="ml-1 text-red-400">!</span>
                        )}
                      </button>
                    </div>
                    {currentAnswerView === 'thorough' && thoroughModel && selectedHistoryIndex === null && (
                      <span className="text-[9px] text-purple-400/60">
                        {thoroughModel === 'gemini-3-pro-preview' ? 'Gemini 3 Pro' : 'Claude Opus 4.5'}
                      </span>
                    )}
                  </div>

                  {/* Live Answer View */}
                  {currentAnswerView === 'live' && (
                    <>
                      {showLiveAnswer ? (
                        <div className="space-y-2">
                          {selectedHistoryIndex === null && presetAnswer && (
                            <span className="text-[9px] bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded">
                              Knowledge Base Match
                            </span>
                          )}
                          <div className="text-base text-gray-100 leading-relaxed font-light whitespace-pre-wrap">
                            {showLiveAnswer}
                            {selectedHistoryIndex === null && isStreaming && (
                              <span className="inline-block w-2 h-4 bg-green-400 ml-1 animate-pulse" />
                            )}
                          </div>
                          <div ref={answerEndRef} />
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 py-8">
                          <div className="text-sm">
                            {isStreaming ? 'Generating answer...' : 'Waiting for response...'}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Thorough Answer View */}
                  {currentAnswerView === 'thorough' && (
                    <div className="space-y-2">
                      {selectedHistoryIndex === null && thoroughError ? (
                        <div className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg p-3">
                          Error: {thoroughError}
                        </div>
                      ) : showThoroughAnswer ? (
                        <div className="text-base text-gray-100 leading-relaxed whitespace-pre-wrap">
                          {showThoroughAnswer}
                        </div>
                      ) : selectedHistoryIndex === null && isThoroughGenerating ? (
                        <div className="flex items-center gap-2 text-purple-300/60 py-8">
                          <span className="inline-block w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                          Generating thorough answer...
                        </div>
                      ) : (
                        <div className="text-gray-500 py-8 text-center text-sm">
                          No thorough answer available
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 py-8">
                  <div className="text-sm">
                    {isStreaming ? 'Generating answer...' : 'Waiting for response...'}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Footer with context summary */}
          {(contextChunks.length > 0 || qaMatches.length > 0) && (
            <div className="px-4 py-2 border-t border-gray-700/50 bg-gray-800/30">
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                {qaMatches.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    {qaMatches.length} Q&A match{qaMatches.length !== 1 ? 'es' : ''}
                  </span>
                )}
                {contextChunks.filter(c => c.type === 'cv').length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    CV context
                  </span>
                )}
                {contextChunks.filter(c => c.type === 'activities').length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Activities context
                  </span>
                )}
                {contextChunks.filter(c => c.type === 'artifact').length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    School artifacts
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
