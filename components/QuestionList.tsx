import React from 'react';
import { InterviewQA } from '../types';

interface QuestionListProps {
  questions: InterviewQA[];
  activeQuestionId: string | null;
  onSelect: (id: string) => void;
  onEdit: (q: InterviewQA) => void;
  onDelete: (id: string) => void;
}

export const QuestionList: React.FC<QuestionListProps> = ({ 
  questions, 
  activeQuestionId, 
  onSelect,
  onEdit,
  onDelete
}) => {
  return (
    <div className="flex-1 overflow-y-auto pr-2 space-y-3">
      {questions.map((q) => (
        <div 
          key={q.id}
          onClick={() => onSelect(q.id)}
          className={`p-4 rounded-lg border transition-all cursor-pointer group relative
            ${activeQuestionId === q.id 
              ? 'bg-blue-900/30 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' 
              : 'bg-gray-800/50 border-gray-700 hover:border-gray-500 hover:bg-gray-800'
            }`}
        >
          <div className="flex justify-between items-start mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              {q.topic}
            </span>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
              <button 
                onClick={(e) => { e.stopPropagation(); onEdit(q); }}
                className="text-xs text-gray-400 hover:text-white"
              >
                Edit
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); onDelete(q.id); }}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Delete
              </button>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-gray-200 mb-2">{q.question}</h3>
          
          {/* Answer Preview (truncated if not active) */}
          <p className={`text-sm text-gray-400 ${activeQuestionId === q.id ? 'text-white' : 'line-clamp-2'}`}>
            {q.answer}
          </p>
        </div>
      ))}
    </div>
  );
};