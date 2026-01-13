import React, { useState, useEffect, useRef } from 'react';
import { EmbeddedChunk, EmbeddingMatch } from '../services/embeddingService';
import { KnowledgeItem } from '../types';

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
}: LiveAnswerPanelProps) {
  const [showChunks, setShowChunks] = useState(false);  // Hide left panel by default
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [expandedChunkIndex, setExpandedChunkIndex] = useState<number | null>(null);
  const answerEndRef = useRef<HTMLDivElement>(null);

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
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Live Answer Assistant</h2>
        </div>
        <button
          onClick={() => setShowChunks(!showChunks)}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          {showChunks ? 'Hide Context' : 'Show Context'}
        </button>
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
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gradient-to-r from-blue-500/10 to-transparent">
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest block mb-1">
              Detected Question
            </span>
            <h2 className="text-lg font-bold text-white leading-snug">
              {question || 'Listening for question...'}
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

            {presetAnswer ? (
              // Show preset answer with highlight
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest">
                    Knowledge Base Match
                  </span>
                  <span className="text-[9px] bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded">
                    Preset Answer
                  </span>
                </div>
                <div className="text-base text-gray-100 leading-relaxed font-light whitespace-pre-wrap">
                  {presetAnswer}
                </div>
              </div>
            ) : streamingAnswer ? (
              // Show streaming answer
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest">
                    Generated Response
                  </span>
                  {isStreaming && (
                    <span className="text-[9px] bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded animate-pulse">
                      Streaming...
                    </span>
                  )}
                </div>
                <div className="text-base text-gray-100 leading-relaxed font-light whitespace-pre-wrap">
                  {streamingAnswer}
                  {isStreaming && (
                    <span className="inline-block w-2 h-4 bg-green-400 ml-1 animate-pulse" />
                  )}
                </div>
                <div ref={answerEndRef} />
              </div>
            ) : (
              // Waiting state
              <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                <div className="text-lg font-medium mb-2">
                  {isStreaming ? 'Generating answer...' : 'Waiting for response...'}
                </div>
                <p className="text-sm text-gray-600">
                  The AI will generate an answer based on the detected question and your context.
                </p>
              </div>
            )}
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
