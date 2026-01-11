import React, { useState, useEffect, useCallback } from 'react';
import { recordingService, RecordingMetadata } from '../services/recordingService';
import { artifactService, Artifact } from '../services/artifactService';

interface RecordingPanelProps {
  streams: { system?: MediaStream; mic?: MediaStream };
  isSessionActive: boolean;
  currentSchool?: string;
  onTranscriptAvailable?: (transcript: string) => void;
}

type RecordingType = 'orientation' | 'interview' | 'practice' | 'other';

export function RecordingPanel({
  streams,
  isSessionActive,
  currentSchool,
  onTranscriptAvailable,
}: RecordingPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingType, setRecordingType] = useState<RecordingType>('orientation');
  const [recordingName, setRecordingName] = useState('');
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  const [savedRecordings, setSavedRecordings] = useState<Artifact[]>([]);
  const [currentBlob, setCurrentBlob] = useState<Blob | null>(null);
  const [currentMetadata, setCurrentMetadata] = useState<RecordingMetadata | null>(null);

  // Load saved recordings on mount
  useEffect(() => {
    const recordings = artifactService.getArtifactsByType('recording');
    setSavedRecordings(recordings);
  }, []);

  // Update recording duration
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingDuration(recordingService.getRecordingDuration());
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = useCallback(() => {
    if (!streams.system && !streams.mic) {
      alert('No audio stream available. Please start a session first.');
      return;
    }

    const name = recordingName || `${recordingType} ${new Date().toLocaleDateString()}`;

    const success = recordingService.startRecording(
      streams,
      {
        name,
        type: recordingType,
        schoolName: currentSchool,
        tags: [recordingType],
      },
      {
        onStop: (blob, metadata) => {
          setCurrentBlob(blob);
          setCurrentMetadata(metadata);
          setShowRecordingModal(true);
          setIsRecording(false);
          setRecordingDuration(0);
        },
        onError: (error) => {
          console.error('Recording error:', error);
          alert(`Recording error: ${error.message}`);
          setIsRecording(false);
        },
      }
    );

    if (success) {
      setIsRecording(true);
    }
  }, [streams, recordingName, recordingType, currentSchool]);

  const stopRecording = useCallback(() => {
    recordingService.stopRecording();
  }, []);

  const saveRecording = useCallback(async () => {
    if (!currentBlob || !currentMetadata) return;

    // Save to file system if in Electron
    let filePath: string | null = null;
    if (window.electronAPI) {
      filePath = await recordingService.saveToFile(currentBlob, currentMetadata);
    }

    // Create blob URL for playback
    const blobUrl = URL.createObjectURL(currentBlob);

    // Add to artifact service
    const artifact = artifactService.addRecordingArtifact(
      currentMetadata,
      undefined, // Transcript will be added later via transcription
      blobUrl,
      filePath || undefined
    );

    setSavedRecordings(artifactService.getArtifactsByType('recording'));
    setShowRecordingModal(false);
    setCurrentBlob(null);
    setCurrentMetadata(null);
    setRecordingName('');
  }, [currentBlob, currentMetadata]);

  const downloadRecording = useCallback(() => {
    if (!currentBlob || !currentMetadata) return;
    recordingService.downloadRecording(currentBlob, currentMetadata);
  }, [currentBlob, currentMetadata]);

  const discardRecording = useCallback(() => {
    setShowRecordingModal(false);
    setCurrentBlob(null);
    setCurrentMetadata(null);
  }, []);

  const deleteArtifact = useCallback((id: string) => {
    if (confirm('Delete this recording?')) {
      artifactService.deleteArtifact(id);
      setSavedRecordings(artifactService.getArtifactsByType('recording'));
    }
  }, []);

  return (
    <div className="p-4 space-y-4">
      {/* Recording Controls */}
      <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Audio Recording
          </h3>
          {isRecording && (
            <span className="flex items-center gap-2 text-red-400">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              {formatDuration(recordingDuration)}
            </span>
          )}
        </div>

        {!isRecording ? (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                Recording Type
              </label>
              <select
                value={recordingType}
                onChange={(e) => setRecordingType(e.target.value as RecordingType)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
              >
                <option value="orientation">Orientation Session</option>
                <option value="interview">Interview</option>
                <option value="practice">Practice</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                Name (Optional)
              </label>
              <input
                type="text"
                value={recordingName}
                onChange={(e) => setRecordingName(e.target.value)}
                placeholder={`${currentSchool || 'School'} ${recordingType}`}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600"
              />
            </div>

            <button
              onClick={startRecording}
              disabled={!isSessionActive && !streams.system && !streams.mic}
              className={`w-full py-2 rounded font-medium text-sm transition-colors ${
                isSessionActive || streams.system || streams.mic
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              Start Recording
            </button>
          </div>
        ) : (
          <button
            onClick={stopRecording}
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium text-sm transition-colors"
          >
            Stop Recording
          </button>
        )}
      </div>

      {/* Saved Recordings */}
      {savedRecordings.length > 0 && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3">
            Saved Recordings ({savedRecordings.length})
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
            {savedRecordings.map((recording) => (
              <div
                key={recording.id}
                className="flex items-center justify-between bg-gray-900/60 rounded px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{recording.name}</p>
                  <p className="text-[10px] text-gray-500">
                    {recording.metadata?.type} - {formatDuration(recording.metadata?.duration || 0)}
                  </p>
                </div>
                <div className="flex gap-1 ml-2">
                  {recording.blobUrl && (
                    <button
                      onClick={() => {
                        const audio = new Audio(recording.blobUrl);
                        audio.play();
                      }}
                      className="p-1 text-gray-400 hover:text-white transition-colors"
                      title="Play"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => deleteArtifact(recording.id)}
                    className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save Recording Modal */}
      {showRecordingModal && currentMetadata && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Save Recording</h3>

            <div className="space-y-4 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Duration</span>
                <span className="text-white">{formatDuration(currentMetadata.duration)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Type</span>
                <span className="text-white capitalize">{currentMetadata.type}</span>
              </div>
              {currentSchool && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">School</span>
                  <span className="text-white">{currentSchool}</span>
                </div>
              )}

              {/* Audio Preview */}
              {currentBlob && (
                <div className="pt-2">
                  <audio
                    controls
                    src={URL.createObjectURL(currentBlob)}
                    className="w-full h-8"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={discardRecording}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium text-sm transition-colors"
              >
                Discard
              </button>
              <button
                onClick={downloadRecording}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium text-sm transition-colors"
              >
                Download
              </button>
              <button
                onClick={saveRecording}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-sm transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
