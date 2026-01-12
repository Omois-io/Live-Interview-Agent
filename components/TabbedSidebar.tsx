import React, { useState, useEffect } from 'react';
import { InterviewQA, ConnectionState } from '../types';
import { contextService } from '../services/contextService';
import { artifactService, Artifact, SchoolInfo } from '../services/artifactService';
import { ParsedActivity } from '../services/activityParserService';
import { QuestionList } from './QuestionList';
import { RecordingPanel } from './RecordingPanel';

type TabId = 'prep' | 'live' | 'artifacts';

interface FoldableSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  badge?: string | number;
  badgeColor?: string;
  children: React.ReactNode;
}

function FoldableSection({ title, isOpen, onToggle, badge, badgeColor = 'bg-gray-700', children }: FoldableSectionProps) {
  return (
    <div className="border-b border-gray-700/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{title}</span>
        </div>
        {badge !== undefined && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeColor} text-white`}>
            {badge}
          </span>
        )}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

interface TabbedSidebarProps {
  // Data
  questions: InterviewQA[];
  activeQuestionId: string | null;
  parsedActivities: ParsedActivity[];
  transcriptHistory: Array<{ id: string; text: string; speaker: string; timestamp: number }>;
  currentTranscript: string;

  // Audio settings
  selectedModel: string;
  audioMode: 'mixed' | 'system' | 'mic';
  selectedMicId: string;
  selectedSystemSource: string;
  audioInputDevices: MediaDeviceInfo[];
  systemAudioSources: Array<{ id: string; name: string; type: string }>;

  // State
  connectionState: ConnectionState;
  streams: { system?: MediaStream; mic?: MediaStream };
  currentSchool: string;
  isEmbedding: boolean;
  embeddingStats?: { qa: number; chunks: number };

  // Callbacks
  onSelectModel: (model: string) => void;
  onSelectAudioMode: (mode: 'mixed' | 'system' | 'mic') => void;
  onSelectMic: (id: string) => void;
  onSelectSystemSource: (id: string) => void;
  onRefreshSources: () => void;
  onSelectQuestion: (id: string) => void;
  onEditQuestion: (q: InterviewQA) => void;
  onDeleteQuestion: (id: string) => void;
  onAddQuestion: () => void;
  onOpenContextModal: () => void;
  onSchoolChange: (school: string) => void;
  onRefreshEmbeddings: () => void;

  // Models list
  liveModels: Array<{ id: string; name: string }>;

  // Platform info
  isElectron: boolean;
  platform?: string;
}

export function TabbedSidebar({
  questions,
  activeQuestionId,
  parsedActivities,
  transcriptHistory,
  currentTranscript,
  selectedModel,
  audioMode,
  selectedMicId,
  selectedSystemSource,
  audioInputDevices,
  systemAudioSources,
  connectionState,
  streams,
  currentSchool,
  isEmbedding,
  embeddingStats,
  onSelectModel,
  onSelectAudioMode,
  onSelectMic,
  onSelectSystemSource,
  onRefreshSources,
  onSelectQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onAddQuestion,
  onOpenContextModal,
  onSchoolChange,
  onRefreshEmbeddings,
  liveModels,
  isElectron,
  platform,
}: TabbedSidebarProps) {
  const [activeTab, setActiveTab] = useState<TabId>('prep');

  // Foldable section states
  const [sections, setSections] = useState({
    readiness: true,
    school: true,
    cv: false,
    activities: true,
    qa: true,
    audio: true,
    transcript: true,
    recordings: true,
    schools: false,
  });

  const toggleSection = (key: keyof typeof sections) => {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Get saved data
  const cv = contextService.loadCV();
  const activities = contextService.loadActivities();
  const recordings = artifactService.getArtifactsByType('recording');
  const schools = artifactService.getAllSchools();

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'prep',
      label: 'Prep',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      ),
    },
    {
      id: 'live',
      label: 'Live',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      ),
    },
    {
      id: 'artifacts',
      label: 'Artifacts',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="flex border-b border-gray-700/50 bg-gray-900/50">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-white bg-gray-800 border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* PREP TAB */}
        {activeTab === 'prep' && (
          <div>
            {/* Readiness Status */}
            <FoldableSection
              title="Session Readiness"
              isOpen={sections.readiness}
              onToggle={() => toggleSection('readiness')}
              badge={isEmbedding ? 'Processing' : 'Ready'}
              badgeColor={isEmbedding ? 'bg-yellow-600 animate-pulse' : 'bg-green-600'}
            >
              {isEmbedding ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-yellow-400">
                    <div className="h-3 w-3 rounded-full bg-yellow-400 animate-pulse" />
                    <span className="text-sm font-medium">Embedding your documents...</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Please wait while we process your CV, activities, and knowledge base for semantic search.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span className="text-sm font-medium">Ready to Start Session!</span>
                  </div>
                  {embeddingStats && (
                    <div className="bg-gray-900 rounded p-3 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Knowledge Base</span>
                        <span className="text-white font-mono">{embeddingStats.qa} Q&A</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Context Chunks</span>
                        <span className="text-white font-mono">{embeddingStats.chunks} chunks</span>
                      </div>
                      <div className="flex justify-between text-xs pt-2 border-t border-gray-700">
                        <span className="text-gray-400">Total Embeddings</span>
                        <span className="text-green-400 font-mono font-bold">
                          {embeddingStats.qa + embeddingStats.chunks}
                        </span>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-gray-500">
                    All documents embedded and ready for semantic search during your interview.
                  </p>
                  {connectionState === ConnectionState.DISCONNECTED && (
                    <button
                      onClick={onRefreshEmbeddings}
                      className="w-full mt-2 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs transition-colors flex items-center justify-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                        <path d="M3 3v5h5"/>
                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                        <path d="M21 21v-5h-5"/>
                      </svg>
                      Refresh Embeddings
                    </button>
                  )}
                </div>
              )}
            </FoldableSection>

            {/* Organization Selector */}
            <FoldableSection
              title="Target Organization"
              isOpen={sections.school}
              onToggle={() => toggleSection('school')}
              badge={currentSchool || 'Not Set'}
              badgeColor={currentSchool ? 'bg-blue-600' : 'bg-gray-700'}
            >
              <input
                type="text"
                value={currentSchool}
                onChange={(e) => onSchoolChange(e.target.value)}
                placeholder="e.g., Google, McKinsey, UTSW, Baylor"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Organization-specific artifacts will be loaded for context
              </p>
            </FoldableSection>

            {/* CV / Personal Statement */}
            <FoldableSection
              title="CV / Personal Statement"
              isOpen={sections.cv}
              onToggle={() => toggleSection('cv')}
              badge={cv ? 'Set' : 'Empty'}
              badgeColor={cv ? 'bg-green-600' : 'bg-gray-700'}
            >
              <button
                onClick={onOpenContextModal}
                className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm transition-colors"
              >
                Edit CV & Activities
              </button>
              {cv && (
                <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400 max-h-32 overflow-y-auto">
                  {cv.slice(0, 300)}...
                </div>
              )}
            </FoldableSection>

            {/* Parsed Activities */}
            <FoldableSection
              title="15 Activities"
              isOpen={sections.activities}
              onToggle={() => toggleSection('activities')}
              badge={parsedActivities.length || (activities ? 'Raw' : 0)}
              badgeColor={parsedActivities.length > 0 ? 'bg-green-600' : activities ? 'bg-yellow-600' : 'bg-gray-700'}
            >
              {parsedActivities.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {parsedActivities.map((activity, idx) => (
                    <div
                      key={activity.id}
                      className={`p-2 rounded border ${
                        activity.isMostMeaningful
                          ? 'bg-yellow-500/10 border-yellow-500/30'
                          : 'bg-gray-900 border-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-white truncate">
                          {idx + 1}. {activity.name}
                        </span>
                        {activity.isMostMeaningful && (
                          <span className="text-[9px] bg-yellow-500/30 text-yellow-300 px-1 rounded">MM</span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        <span className="text-[9px] bg-gray-700 text-gray-300 px-1 rounded">
                          {activity.type}
                        </span>
                        <span className="text-[9px] bg-gray-700 text-gray-300 px-1 rounded">
                          {activity.hours}hrs
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : activities ? (
                <div className="text-xs text-yellow-400">
                  Activities will be parsed when session starts
                </div>
              ) : (
                <button
                  onClick={onOpenContextModal}
                  className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm transition-colors"
                >
                  Add Activities
                </button>
              )}
            </FoldableSection>

            {/* Q&A Knowledge Base */}
            <FoldableSection
              title="Q&A Knowledge Base"
              isOpen={sections.qa}
              onToggle={() => toggleSection('qa')}
              badge={questions.length}
              badgeColor="bg-purple-600"
            >
              <div className="flex justify-end mb-2">
                <button
                  onClick={onAddQuestion}
                  className="text-xs px-2 py-1 bg-gray-700/80 rounded hover:bg-gray-600 text-white"
                >
                  + Add
                </button>
              </div>
              <QuestionList
                questions={questions}
                activeQuestionId={activeQuestionId}
                onSelect={onSelectQuestion}
                onEdit={onEditQuestion}
                onDelete={onDeleteQuestion}
              />
            </FoldableSection>
          </div>
        )}

        {/* LIVE TAB */}
        {activeTab === 'live' && (
          <div>
            {/* Audio Settings */}
            <FoldableSection
              title="Audio Settings"
              isOpen={sections.audio}
              onToggle={() => toggleSection('audio')}
            >
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                    AI Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => onSelectModel(e.target.value)}
                    disabled={connectionState !== ConnectionState.DISCONNECTED}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
                  >
                    {liveModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                    Listening Mode
                  </label>
                  <select
                    value={audioMode}
                    onChange={(e) => onSelectAudioMode(e.target.value as any)}
                    disabled={connectionState !== ConnectionState.DISCONNECTED}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
                  >
                    <option value="mixed">System + Mic</option>
                    <option value="system">System Only</option>
                    <option value="mic">Mic Only</option>
                  </select>
                </div>

                {isElectron && audioMode !== 'mic' && (
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                      {platform === 'win32' ? 'Screen Source' : 'System Audio'}
                    </label>
                    <div className="flex gap-1">
                      <select
                        value={selectedSystemSource}
                        onChange={(e) => onSelectSystemSource(e.target.value)}
                        disabled={connectionState !== ConnectionState.DISCONNECTED}
                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
                      >
                        {systemAudioSources.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name.length > 25 ? s.name.slice(0, 25) + '...' : s.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={onRefreshSources}
                        disabled={connectionState !== ConnectionState.DISCONNECTED}
                        className="px-2 bg-gray-800 border border-gray-700 rounded text-gray-400 hover:text-white"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                          <path d="M3 3v5h5"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                    Microphone
                  </label>
                  <select
                    value={selectedMicId}
                    onChange={(e) => onSelectMic(e.target.value)}
                    disabled={connectionState !== ConnectionState.DISCONNECTED}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
                  >
                    {audioInputDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Mic ${d.deviceId.slice(0, 5)}...`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </FoldableSection>

            {/* Recording */}
            <FoldableSection
              title="Record Session"
              isOpen={sections.recordings}
              onToggle={() => toggleSection('recordings')}
            >
              <RecordingPanel
                streams={streams}
                isSessionActive={connectionState === ConnectionState.CONNECTED}
                currentSchool={currentSchool}
              />
            </FoldableSection>

            {/* Live Transcript */}
            <FoldableSection
              title="Live Transcript"
              isOpen={sections.transcript}
              onToggle={() => toggleSection('transcript')}
              badge={transcriptHistory.length}
            >
              <div className="max-h-64 overflow-y-auto space-y-2">
                {transcriptHistory.length === 0 && !currentTranscript ? (
                  <p className="text-xs text-gray-600 italic">Conversations appear here...</p>
                ) : (
                  <>
                    {transcriptHistory.map(item => (
                      <div key={item.id} className="text-sm">
                        <span className={`text-[10px] uppercase font-bold ${
                          item.speaker === 'you' ? 'text-green-400' : 'text-blue-400'
                        }`}>
                          {item.speaker === 'you' ? 'You' : 'Interviewer'}
                        </span>
                        <p className="text-gray-300 text-xs leading-snug">{item.text}</p>
                      </div>
                    ))}
                    {currentTranscript && (
                      <div className="text-sm text-white font-medium animate-pulse">
                        <span className="text-gray-500 text-[10px]">...</span> {currentTranscript}
                      </div>
                    )}
                  </>
                )}
              </div>
            </FoldableSection>
          </div>
        )}

        {/* ARTIFACTS TAB */}
        {activeTab === 'artifacts' && (
          <div>
            {/* Recordings */}
            <FoldableSection
              title="Recordings"
              isOpen={sections.recordings}
              onToggle={() => toggleSection('recordings')}
              badge={recordings.length}
              badgeColor={recordings.length > 0 ? 'bg-purple-600' : 'bg-gray-700'}
            >
              {recordings.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {recordings.map(rec => (
                    <div key={rec.id} className="flex items-center justify-between bg-gray-900 rounded px-2 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white truncate">{rec.name}</p>
                        <p className="text-[10px] text-gray-500">
                          {rec.metadata?.type} - {rec.schoolName || 'General'}
                        </p>
                      </div>
                      {rec.blobUrl && (
                        <button
                          onClick={() => new Audio(rec.blobUrl!).play()}
                          className="p-1 text-gray-400 hover:text-white"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">No recordings yet. Use the Live tab to record.</p>
              )}
            </FoldableSection>

            {/* Schools */}
            <FoldableSection
              title="School Information"
              isOpen={sections.schools}
              onToggle={() => toggleSection('schools')}
              badge={schools.length}
            >
              {schools.length > 0 ? (
                <div className="space-y-2">
                  {schools.map(school => (
                    <div key={school.id} className="bg-gray-900 rounded p-2">
                      <p className="text-xs font-medium text-white">{school.name}</p>
                      {school.mission && (
                        <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">{school.mission}</p>
                      )}
                      <p className="text-[10px] text-gray-500 mt-1">
                        {school.artifacts.length} artifacts
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  Record orientation sessions and they'll appear here organized by school.
                </p>
              )}
            </FoldableSection>
          </div>
        )}
      </div>
    </div>
  );
}
