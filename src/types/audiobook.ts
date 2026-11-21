export type AudiobookStatus = 'not_started' | 'in_progress' | 'completed';

export type AudioStorageType = 'opfs' | 'idb';

export type SortOption = 'name' | 'importedAt' | 'lastPlayedAt';

export type FilterOption = 'all' | AudiobookStatus;

export const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export interface AudiobookRecord {
  id: string;
  fingerprint: string;
  originalName: string;
  customName: string;
  storageType: AudioStorageType;
  storageKey: string;
  fileSize: number;
  mimeType: string;
  lastModified: number;
  duration: number;
  importedAt: number;
  lastPlayedAt: number | null;
  currentTime: number;
  playbackRate: PlaybackRate;
  status: AudiobookStatus;
}

export interface PlaybackCheckpoint {
  id: string;
  currentTime: number;
  duration: number;
  status: AudiobookStatus;
  playbackRate: PlaybackRate;
  updatedAt: number;
}

export interface StorageEstimateInfo {
  usage: number;
  quota: number;
  available: number;
  persisted: boolean;
  supported: boolean;
}

export interface ImportProgress {
  phase: 'scanning' | 'checking' | 'importing' | 'done';
  totalFiles: number;
  processedFiles: number;
  currentFileName: string;
  currentFilePercent: number;
  overallPercent: number;
}

export interface ImportResult {
  imported: AudiobookRecord[];
  duplicates: string[];
  unsupportedCount: number;
  failed: Array<{ fileName: string; reason: string }>;
  insufficientStorage?: {
    requiredBytes: number;
    availableBytes: number;
  };
}
