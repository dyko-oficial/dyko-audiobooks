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
  /**
   * Byte size of the original source file as selected by the user (remains stable
   * even if an MP4 is remuxed into a smaller audio-only .m4a copy).
   */
  originalFileSize?: number;
  /**
   * Fast sampled content hash (size + head/middle/tail slices) of the original source file
   * used to prevent duplicate imports across single-file and folder selections.
   */
  contentHash?: string;
  /**
   * True for native MP3 files and MP4 files whose video track was stripped (or never existed).
   * False/undefined for legacy or fallback full MP4 files containing a video track.
   */
  audioOptimized?: boolean;
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
  phase: 'scanning' | 'checking' | 'remuxing' | 'importing' | 'done';
  totalFiles: number;
  processedFiles: number;
  currentFileName: string;
  currentFilePercent: number;
  overallPercent: number;
}

export interface ImportWarning {
  fileName: string;
  message: string;
}

export interface ImportResult {
  imported: AudiobookRecord[];
  duplicates: string[];
  unsupportedCount: number;
  optimizedCount: number;
  warnings: ImportWarning[];
  failed: Array<{ fileName: string; reason: string }>;
  insufficientStorage?: {
    requiredBytes: number;
    availableBytes: number;
  };
}
