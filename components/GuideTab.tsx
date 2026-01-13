import React, { useState, useEffect } from 'react';
import { InstructionPreset } from '../types';

const PRESETS_STORAGE_KEY = 'interview_hud_presets';

const DEFAULT_PRESETS: InstructionPreset[] = [
  {
    id: 'default-mmi-2min',
    title: 'MMI 2-minute',
    instructions: 'Keep your answers under 2 minutes. Be concise and focus on one main point. Structure: brief context, main action, clear outcome.',
    createdAt: Date.now(),
  },
  {
    id: 'default-traditional',
    title: 'Traditional Interview',
    instructions: 'Give detailed answers with specific examples. Use the STAR method (Situation, Task, Action, Result). Show depth of experience.',
    createdAt: Date.now(),
  },
  {
    id: 'default-concise',
    title: 'Be Concise',
    instructions: 'Keep responses brief and direct. Bullet points are fine. Focus on key takeaways only.',
    createdAt: Date.now(),
  },
];

interface GuideTabProps {
  activePresetId: string | null;
  onTogglePreset: (id: string) => void;
}

export function GuideTab({ activePresetId, onTogglePreset }: GuideTabProps) {
  const [presets, setPresets] = useState<InstructionPreset[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingPreset, setEditingPreset] = useState<InstructionPreset | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalInstructions, setModalInstructions] = useState('');

  // Load presets from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (saved) {
      setPresets(JSON.parse(saved));
    } else {
      // First time - use defaults
      setPresets(DEFAULT_PRESETS);
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(DEFAULT_PRESETS));
    }
  }, []);

  // Save presets to localStorage
  const savePresets = (newPresets: InstructionPreset[]) => {
    setPresets(newPresets);
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(newPresets));
  };

  const openNewModal = () => {
    setEditingPreset(null);
    setModalTitle('');
    setModalInstructions('');
    setShowModal(true);
  };

  const openEditModal = (preset: InstructionPreset) => {
    setEditingPreset(preset);
    setModalTitle(preset.title);
    setModalInstructions(preset.instructions);
    setShowModal(true);
  };

  const handleSavePreset = () => {
    if (!modalTitle.trim() || !modalInstructions.trim()) return;

    if (editingPreset) {
      // Update existing
      const updated = presets.map(p =>
        p.id === editingPreset.id
          ? { ...p, title: modalTitle.trim(), instructions: modalInstructions.trim() }
          : p
      );
      savePresets(updated);
    } else {
      // Add new
      const newPreset: InstructionPreset = {
        id: `preset-${Date.now()}`,
        title: modalTitle.trim(),
        instructions: modalInstructions.trim(),
        createdAt: Date.now(),
      };
      savePresets([...presets, newPreset]);
    }

    setShowModal(false);
    setModalTitle('');
    setModalInstructions('');
    setEditingPreset(null);
  };

  const handleDeletePreset = (id: string) => {
    const updated = presets.filter(p => p.id !== id);
    savePresets(updated);
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Interview Mode</h3>
        <button
          onClick={openNewModal}
          className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
        >
          + New Preset
        </button>
      </div>

      {/* Info */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded p-2">
        <p className="text-[10px] text-gray-400">
          Active preset will be included in system prompt when session starts.
        </p>
      </div>

      {/* Preset List */}
      <div className="space-y-3">
        {presets.map(preset => {
          const isActive = activePresetId === preset.id;

          return (
            <div
              key={preset.id}
              className={`rounded-lg p-3 transition-colors ${
                isActive
                  ? 'bg-green-900/30 border-2 border-green-500/50'
                  : 'bg-gray-800/50 border border-gray-700/50 hover:border-gray-600'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-medium text-white">{preset.title}</h4>
                {isActive && (
                  <span className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded-full font-bold">
                    ACTIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-3 line-clamp-2">{preset.instructions}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => onTogglePreset(preset.id)}
                  className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                    isActive
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                      : 'bg-green-600 hover:bg-green-500 text-white'
                  }`}
                >
                  {isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => openEditModal(preset)}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeletePreset(preset.id)}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-red-900/50 text-gray-400 hover:text-red-400 rounded transition-colors"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* No Active Indicator */}
      {!activePresetId && presets.length > 0 && (
        <div className="text-center py-2">
          <p className="text-xs text-gray-500">No preset active - using default behavior</p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-white mb-4">
              {editingPreset ? 'Edit Preset' : 'New Preset'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
                  placeholder="e.g., MMI 5-minute"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">
                  Instructions for AI
                </label>
                <textarea
                  value={modalInstructions}
                  onChange={(e) => setModalInstructions(e.target.value)}
                  placeholder="Guide how the AI should respond..."
                  rows={4}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePreset}
                disabled={!modalTitle.trim() || !modalInstructions.trim()}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
              >
                {editingPreset ? 'Save Changes' : 'Save Preset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Export function to get presets (for use in App.tsx)
export function getStoredPresets(): InstructionPreset[] {
  const saved = localStorage.getItem(PRESETS_STORAGE_KEY);
  if (saved) {
    return JSON.parse(saved);
  }
  return DEFAULT_PRESETS;
}
