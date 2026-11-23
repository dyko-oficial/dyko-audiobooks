import type {
  AudiobookRecord,
  AudioStorageType,
  ImportProgress,
  ImportResult,
} from '../types/audiobook';
import { getAllAudiobooks, putAudiobook, updateAudiobookFields } from '../storage/db';
import {
  deleteAudioFile,
  getAudioFile,
  getStorageEstimate,
  requestPersistentStorage,
  saveAudioFile,
  saveAudioFromWriter,
} from '../storage/fileStorage';
import { cleanAudiobookTitle } from '../utils/format';
import { Mp4RemuxError, remuxMp4ToAudioOnly } from './mp4AudioRemuxer';

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

const SUPPORTED_EXTENSIONS = ['.mp3', '.mp4', '.m4a'];
const SUPPORTED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/x-mpeg',
  'audio/x-mp3',
  'video/mp4',
  'audio/mp4',
  'audio/x-m4a',
  'application/mp4',
]);

export function isDirectoryPickerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
  );
}

export function isSupportedAudioFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  if (SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return true;
  }
  if (file.type && SUPPORTED_MIME_TYPES.has(file.type.toLowerCase())) {
    return true;
  }
  return false;
}

export function isMp4ContainerFile(fileName: string, mimeType?: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  return lowerName.endsWith('.mp4') || lowerMime.includes('video/mp4') || lowerMime === 'application/mp4';
}

export function needsMp4Optimization(book: AudiobookRecord): boolean {
  if (book.audioOptimized === true) return false;
  const lowerOrig = book.originalName.toLowerCase();
  const lowerKey = book.storageKey.toLowerCase();
  const lowerMime = (book.mimeType || '').toLowerCase();
  return (
    lowerOrig.endsWith('.mp4') ||
    lowerKey.endsWith('.mp4') ||
    lowerMime.includes('video/mp4') ||
    lowerMime === 'application/mp4'
  );
}

export function normalizeFileNameForKey(fileName: string): string {
  return fileName.normalize('NFC').trim().toLowerCase();
}

export function computeNameSizeKey(fileName: string, size: number): string {
  return `${normalizeFileNameForKey(fileName)}::${size}`;
}

export function computeFileFingerprint(file: File): string {
  return `${normalizeFileNameForKey(file.name)}::${file.size}::${file.lastModified}`;
}

/**
 * Extracts all known normalized `name::size` keys from an existing AudiobookRecord,
 * including the original pre-optimization file size encoded in legacy fingerprints.
 */
export function extractExistingNameSizeKeys(book: AudiobookRecord): string[] {
  const keys = new Set<string>();

  if (typeof book.originalFileSize === 'number' && book.originalFileSize > 0) {
    keys.add(computeNameSizeKey(book.originalName, book.originalFileSize));
  }

  if (typeof book.fileSize === 'number' && book.fileSize > 0) {
    keys.add(computeNameSizeKey(book.originalName, book.fileSize));
  }

  // Parse legacy fingerprint format: `${name}::${originalSize}::${lastModified}`
  // Split from the right so filenames containing '::' are parsed safely.
  if (book.fingerprint) {
    const lastSep = book.fingerprint.lastIndexOf('::');
    if (lastSep > 0) {
      const prevSep = book.fingerprint.lastIndexOf('::', lastSep - 1);
      if (prevSep > 0) {
        const fpName = book.fingerprint.slice(0, prevSep);
        const fpSize = Number(book.fingerprint.slice(prevSep + 2, lastSep));
        if (Number.isFinite(fpSize) && fpSize > 0) {
          keys.add(computeNameSizeKey(fpName || book.originalName, fpSize));
          keys.add(computeNameSizeKey(book.originalName, fpSize));
        }
      }
    }
  }

  return Array.from(keys);
}

const HASH_SAMPLE_BYTES = 64 * 1024; // 64 KB per sample window (<= 192 KB total read)

function fallbackDigestHex(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= b + ((i & 0xff) ^ 0xa5);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Computes a fast sampled content hash (size + head/middle/tail 64 KB windows)
 * without loading multi-hour audio/MP4 files into RAM.
 */
export async function computePartialContentHash(blob: Blob): Promise<string> {
  const size = blob.size;
  const sizeHeader = new Uint8Array(8);
  const view = new DataView(sizeHeader.buffer);
  view.setUint32(0, Math.floor(size / 4294967296), false);
  view.setUint32(4, size >>> 0, false);

  let sampleParts: Uint8Array[];
  if (size <= HASH_SAMPLE_BYTES * 3) {
    const full = new Uint8Array(await blob.arrayBuffer());
    sampleParts = [sizeHeader, full];
  } else {
    const midStart = Math.floor((size - HASH_SAMPLE_BYTES) / 2);
    const tailStart = size - HASH_SAMPLE_BYTES;
    const [headBuf, midBuf, tailBuf] = await Promise.all([
      blob.slice(0, HASH_SAMPLE_BYTES).arrayBuffer(),
      blob.slice(midStart, midStart + HASH_SAMPLE_BYTES).arrayBuffer(),
      blob.slice(tailStart, size).arrayBuffer(),
    ]);
    sampleParts = [
      sizeHeader,
      new Uint8Array(headBuf),
      new Uint8Array(midBuf),
      new Uint8Array(tailBuf),
    ];
  }

  const totalLen = sampleParts.reduce((acc, p) => acc + p.byteLength, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of sampleParts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }

  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const digestBuf = await crypto.subtle.digest('SHA-256', combined);
      const digestBytes = new Uint8Array(digestBuf);
      let hex = '';
      for (let i = 0; i < digestBytes.length; i++) {
        hex += digestBytes[i].toString(16).padStart(2, '0');
      }
      return `v1:${size}:${hex}`;
    } catch {
      // Fall back to deterministic hash if WebCrypto is unavailable in current context
    }
  }

  return `v1f:${size}:${fallbackDigestHex(combined)}`;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Extracts duration from audio/MP4 metadata without decoding the entire multi-hour file.
 */
export function extractAudioDuration(file: File | Blob, fileNameHint = ''): Promise<number> {
  const probeDuration = (sourceBlob: Blob): Promise<number> =>
    new Promise((resolve) => {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(sourceBlob);
      let settled = false;

      const cleanup = (duration: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
      };

      const timer = window.setTimeout(() => cleanup(0), 12000);

      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        if (audio.duration === Infinity) {
          audio.currentTime = 1e7;
          audio.ontimeupdate = () => {
            audio.ontimeupdate = null;
            const computed = Number.isFinite(audio.duration) ? audio.duration : 0;
            cleanup(computed);
          };
        } else {
          cleanup(audio.duration);
        }
      };
      audio.onerror = () => cleanup(0);
      audio.src = url;
    });

  const name = file instanceof File ? file.name : fileNameHint;
  if (isMp4ContainerFile(name, file.type)) {
    const audioTypedSlice = file.slice(0, file.size, 'audio/mp4');
    return probeDuration(audioTypedSlice).then((dur) => (dur > 0 ? dur : probeDuration(file)));
  }

  return probeDuration(file);
}

async function collectFilesFromDirectory(
  dirHandle: FileSystemDirectoryHandle,
  depth = 0
): Promise<File[]> {
  if (depth > 4) return [];
  const collected: File[] = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      try {
        const file = await entry.getFile();
        collected.push(file);
      } catch {
        // Skip unreadable entries
      }
    } else if (entry.kind === 'directory') {
      try {
        const nested = await collectFilesFromDirectory(entry, depth + 1);
        collected.push(...nested);
      } catch {
        // Skip unreadable subdirectories
      }
    }
  }

  return collected;
}

export async function pickFilesFromDirectory(): Promise<{ files: File[]; cancelled: boolean }> {
  const win = window as DirectoryPickerWindow;
  if (!win.showDirectoryPicker) {
    throw new Error('Seleção de pasta não suportada neste navegador.');
  }

  try {
    const dirHandle = await win.showDirectoryPicker({ mode: 'read' });
    const files = await collectFilesFromDirectory(dirHandle);
    return { files, cancelled: false };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { files: [], cancelled: true };
    }
    throw err;
  }
}

interface StoredImportOutcome {
  storageType: AudioStorageType;
  storageKey: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  audioOptimized: boolean;
  warningMessage?: string;
}

/**
 * Stores a single MP3/M4A/MP4 file. For MP4 files, attempts lossless streaming
 * remux to strip the video track ('vide') without re-encoding. Falls back cleanly
 * to storing the full MP4 with a clear user warning if remux fails.
 */
async function storeSingleAudiobookFile(
  storageId: string,
  file: File,
  onPhaseProgress: (phase: 'remuxing' | 'importing', percent: number) => void
): Promise<StoredImportOutcome> {
  const isMp4 = isMp4ContainerFile(file.name, file.type);

  if (!isMp4) {
    const [{ storageType, storageKey }, duration] = await Promise.all([
      saveAudioFile(storageId, file, file.name, (pct) => onPhaseProgress('importing', pct)),
      extractAudioDuration(file, file.name),
    ]);
    return {
      storageType,
      storageKey,
      fileSize: file.size,
      mimeType: file.type || (file.name.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg'),
      duration,
      audioOptimized: true,
    };
  }

  // MP4 path: stream-remux audio track directly into OPFS/IDB as fast-start .m4a
  try {
    onPhaseProgress('remuxing', 1);
    const saved = await saveAudioFromWriter(storageId, '.m4a', 'audio/mp4', (writeChunk) =>
      remuxMp4ToAudioOnly(file, writeChunk, (pct) => onPhaseProgress('remuxing', pct))
    );

    if (saved.writerResult.status === 'already_audio_only') {
      // Remove empty placeholder created before early return, then stream-copy as audio-only .m4a
      await deleteAudioFile(saved.storageType, saved.storageKey);
      const [{ storageType, storageKey }, probedDuration] = await Promise.all([
        saveAudioFile(
          storageId,
          file.slice(0, file.size, 'audio/mp4'),
          file.name,
          (pct) => onPhaseProgress('importing', pct),
          '.m4a'
        ),
        saved.writerResult.durationSeconds > 0
          ? Promise.resolve(saved.writerResult.durationSeconds)
          : extractAudioDuration(file, file.name),
      ]);
      return {
        storageType,
        storageKey,
        fileSize: file.size,
        mimeType: 'audio/mp4',
        duration: probedDuration,
        audioOptimized: true,
      };
    }

    // Remuxed successfully — verify duration from header or quick metadata probe on the fast-start .m4a
    let duration = saved.writerResult.durationSeconds;
    if (!Number.isFinite(duration) || duration <= 0) {
      const storedBlob = await getAudioFile(saved.storageType, saved.storageKey);
      if (storedBlob) {
        duration = await extractAudioDuration(storedBlob, `${storageId}.m4a`);
      }
    }

    return {
      storageType: saved.storageType,
      storageKey: saved.storageKey,
      fileSize: saved.bytesWritten,
      mimeType: 'audio/mp4',
      duration,
      audioOptimized: true,
    };
  } catch (err) {
    // Clean up any partial artifact, then fall back to storing the full MP4 copy with user warning
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw err;
    }

    const reasonDetail =
      err instanceof Mp4RemuxError
        ? err.message
        : 'Estrutura MP4 não suportada para remoção direta do vídeo.';

    const currentEstimate = await getStorageEstimate();
    if (currentEstimate.supported && file.size > currentEstimate.available) {
      throw new DOMException('Espaço insuficiente para salvar cópia integral.', 'QuotaExceededError');
    }

    const [{ storageType, storageKey }, duration] = await Promise.all([
      saveAudioFile(storageId, file, file.name, (pct) => onPhaseProgress('importing', pct), '.mp4'),
      extractAudioDuration(file, file.name),
    ]);

    return {
      storageType,
      storageKey,
      fileSize: file.size,
      mimeType: file.type || 'video/mp4',
      duration,
      audioOptimized: false,
      warningMessage: `${reasonDetail} O arquivo foi importado integralmente (fallback) e pode exigir retomada pela notificação ao bloquear a tela.`,
    };
  }
}

export async function importAudioFiles(
  rawFiles: File[],
  existingBooks: AudiobookRecord[],
  onProgress: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: [],
    duplicates: [],
    unsupportedCount: 0,
    optimizedCount: 0,
    warnings: [],
    failed: [],
  };

  if (rawFiles.length === 0) {
    return result;
  }

  onProgress({
    phase: 'checking',
    totalFiles: rawFiles.length,
    processedFiles: 0,
    currentFileName: 'Verificando arquivos e espaço disponível...',
    currentFilePercent: 0,
    overallPercent: 0,
  });

  await requestPersistentStorage();

  // Always merge live IndexedDB records with React state so previously imported files
  // are never missed even across consecutive imports or before state flushes.
  const persistedBooks = await getAllAudiobooks().catch(() => []);
  const libraryById = new Map<string, AudiobookRecord>();
  for (const book of existingBooks) {
    libraryById.set(book.id, book);
  }
  for (const book of persistedBooks) {
    libraryById.set(book.id, book);
  }
  const allExistingBooks = Array.from(libraryById.values());

  const existingFingerprints = new Set<string>();
  const existingNameSizeKeys = new Set<string>();
  const existingContentHashes = new Set<string>();

  for (const book of allExistingBooks) {
    if (book.fingerprint) {
      existingFingerprints.add(book.fingerprint);
    }
    for (const key of extractExistingNameSizeKeys(book)) {
      existingNameSizeKeys.add(key);
    }
    if (book.contentHash) {
      existingContentHashes.add(book.contentHash);
    }
  }

  const seenFingerprintsInBatch = new Set<string>();
  const seenNameSizeInBatch = new Set<string>();
  const seenContentHashesInBatch = new Set<string>();

  interface QueuedImportFile {
    file: File;
    fingerprint: string;
    contentHash: string;
  }

  const filesToImport: QueuedImportFile[] = [];

  for (const file of rawFiles) {
    if (!isSupportedAudioFile(file)) {
      result.unsupportedCount += 1;
      continue;
    }

    if (file.size === 0) {
      result.failed.push({ fileName: file.name, reason: 'Arquivo vazio ou inválido.' });
      continue;
    }

    const fp = computeFileFingerprint(file);
    const nameSizeKey = computeNameSizeKey(file.name, file.size);

    if (
      existingFingerprints.has(fp) ||
      seenFingerprintsInBatch.has(fp) ||
      existingNameSizeKeys.has(nameSizeKey) ||
      seenNameSizeInBatch.has(nameSizeKey)
    ) {
      result.duplicates.push(file.name);
      continue;
    }

    let contentHash = '';
    try {
      contentHash = await computePartialContentHash(file);
    } catch {
      contentHash = '';
    }

    if (
      contentHash &&
      (existingContentHashes.has(contentHash) || seenContentHashesInBatch.has(contentHash))
    ) {
      result.duplicates.push(file.name);
      continue;
    }

    seenFingerprintsInBatch.add(fp);
    seenNameSizeInBatch.add(nameSizeKey);
    if (contentHash) {
      seenContentHashesInBatch.add(contentHash);
    }

    filesToImport.push({ file, fingerprint: fp, contentHash });
  }

  if (filesToImport.length === 0) {
    onProgress({
      phase: 'done',
      totalFiles: 0,
      processedFiles: 0,
      currentFileName: '',
      currentFilePercent: 100,
      overallPercent: 100,
    });
    return result;
  }

  // Conservative quota pre-check: full size for MP3/M4A, estimated ~20% audio ratio for MP4 (exact check runs on fallback)
  const estimatedBytesNeeded = filesToImport.reduce((acc, item) => {
    const isMp4 = isMp4ContainerFile(item.file.name, item.file.type);
    return acc + (isMp4 ? Math.round(item.file.size * 0.2) : item.file.size);
  }, 0);

  const estimate = await getStorageEstimate();
  if (estimate.supported) {
    const safetyBuffer = Math.max(10 * 1024 * 1024, Math.round(estimatedBytesNeeded * 0.05));
    if (estimatedBytesNeeded + safetyBuffer > estimate.available) {
      result.insufficientStorage = {
        requiredBytes: estimatedBytesNeeded,
        availableBytes: estimate.available,
      };
      onProgress({
        phase: 'done',
        totalFiles: filesToImport.length,
        processedFiles: 0,
        currentFileName: '',
        currentFilePercent: 0,
        overallPercent: 0,
      });
      return result;
    }
  }

  const totalToImport = filesToImport.length;

  for (let i = 0; i < totalToImport; i++) {
    const { file, fingerprint, contentHash } = filesToImport[i];
    const baseOverall = (i / totalToImport) * 100;
    const isMp4 = isMp4ContainerFile(file.name, file.type);

    onProgress({
      phase: isMp4 ? 'remuxing' : 'importing',
      totalFiles: totalToImport,
      processedFiles: i,
      currentFileName: file.name,
      currentFilePercent: 0,
      overallPercent: Math.round(baseOverall),
    });

    try {
      const id = generateId();

      // Verify remaining space before each non-MP4 file
      if (!isMp4) {
        const currentEstimate = await getStorageEstimate();
        if (currentEstimate.supported && file.size > currentEstimate.available) {
          result.insufficientStorage = {
            requiredBytes: file.size,
            availableBytes: currentEstimate.available,
          };
          result.failed.push({
            fileName: file.name,
            reason: 'Armazenamento local insuficiente para copiar este arquivo.',
          });
          break;
        }
      }

      const stored = await storeSingleAudiobookFile(id, file, (phase, filePct) => {
        const overall = Math.round(((i + filePct / 100) / totalToImport) * 100);
        onProgress({
          phase,
          totalFiles: totalToImport,
          processedFiles: i,
          currentFileName: file.name,
          currentFilePercent: filePct,
          overallPercent: Math.min(99, overall),
        });
      });

      const record: AudiobookRecord = {
        id,
        fingerprint,
        originalName: file.name,
        customName: cleanAudiobookTitle(file.name),
        storageType: stored.storageType,
        storageKey: stored.storageKey,
        fileSize: stored.fileSize,
        originalFileSize: file.size,
        contentHash: contentHash || undefined,
        mimeType: stored.mimeType,
        lastModified: file.lastModified || Date.now(),
        duration: stored.duration,
        importedAt: Date.now() + i,
        lastPlayedAt: null,
        currentTime: 0,
        playbackRate: 1.0,
        status: 'not_started',
        audioOptimized: stored.audioOptimized,
      };

      await putAudiobook(record);
      result.imported.push(record);

      if (isMp4 && stored.audioOptimized) {
        result.optimizedCount += 1;
      }

      if (stored.warningMessage) {
        result.warnings.push({
          fileName: file.name,
          message: stored.warningMessage,
        });
      }
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'QuotaExceededError'
          ? 'Espaço de armazenamento esgotado durante a importação.'
          : err instanceof Error
            ? err.message
            : 'Falha ao copiar o arquivo para o armazenamento local.';

      result.failed.push({ fileName: file.name, reason: message });
    }
  }

  onProgress({
    phase: 'done',
    totalFiles: totalToImport,
    processedFiles: totalToImport,
    currentFileName: '',
    currentFilePercent: 100,
    overallPercent: 100,
  });

  return result;
}

export interface OptimizeBookResult {
  updated: AudiobookRecord;
  savedBytes: number;
  alreadyAudioOnly: boolean;
}

/**
 * Optimizes an already-imported MP4 audiobook in-place without touching its
 * custom name, playback position, speed, status, or original file fingerprint.
 * Safely writes to a new storage key first and deletes the old bulky MP4 copy only after commit.
 */
export async function optimizeExistingAudiobook(
  book: AudiobookRecord,
  onProgress?: (percent: number) => void
): Promise<OptimizeBookResult> {
  const existingBlob = await getAudioFile(book.storageType, book.storageKey);
  if (!existingBlob) {
    throw new Error('Arquivo local não encontrado para otimização.');
  }

  const oldStorageType = book.storageType;
  const oldStorageKey = book.storageKey;
  const oldSize = existingBlob.size || book.fileSize;
  const nextStorageId = `${book.id}_opt_${Date.now()}`;

  const saved = await saveAudioFromWriter(nextStorageId, '.m4a', 'audio/mp4', (writeChunk) =>
    remuxMp4ToAudioOnly(existingBlob, writeChunk, onProgress)
  );

  if (saved.writerResult.status === 'already_audio_only') {
    await deleteAudioFile(saved.storageType, saved.storageKey);
    const updated = await updateAudiobookFields(book.id, {
      mimeType: 'audio/mp4',
      audioOptimized: true,
      duration:
        book.duration > 0
          ? book.duration
          : saved.writerResult.durationSeconds > 0
            ? saved.writerResult.durationSeconds
            : book.duration,
    });
    return {
      updated: updated ?? { ...book, mimeType: 'audio/mp4', audioOptimized: true },
      savedBytes: 0,
      alreadyAudioOnly: true,
    };
  }

  // Atomically commit new optimized storage pointer while preserving all user progress & metadata
  const updated = await updateAudiobookFields(book.id, {
    storageType: saved.storageType,
    storageKey: saved.storageKey,
    fileSize: saved.bytesWritten,
    mimeType: 'audio/mp4',
    audioOptimized: true,
    duration:
      book.duration > 0
        ? book.duration
        : saved.writerResult.durationSeconds > 0
          ? saved.writerResult.durationSeconds
          : book.duration,
  });

  if (!updated) {
    await deleteAudioFile(saved.storageType, saved.storageKey);
    throw new Error('Audiolivro não encontrado na biblioteca.');
  }

  // Reclaim storage by removing the old full MP4 copy only after DB update succeeded
  if (oldStorageKey !== saved.storageKey || oldStorageType !== saved.storageType) {
    await deleteAudioFile(oldStorageType, oldStorageKey);
  }

  return {
    updated,
    savedBytes: Math.max(0, oldSize - saved.bytesWritten),
    alreadyAudioOnly: false,
  };
}
