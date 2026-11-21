import type { AudiobookRecord, ImportProgress, ImportResult } from '../types/audiobook';
import { putAudiobook } from '../storage/db';
import { getStorageEstimate, requestPersistentStorage, saveAudioFile } from '../storage/fileStorage';
import { cleanAudiobookTitle } from '../utils/format';

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

const SUPPORTED_EXTENSIONS = ['.mp3', '.mp4'];
const SUPPORTED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/x-mpeg',
  'audio/x-mp3',
  'video/mp4',
  'audio/mp4',
  'application/mp4',
]);

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
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

export function isMp4File(fileName: string, mimeType?: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  return lowerName.endsWith('.mp4') || lowerMime.includes('mp4');
}

export function computeFileFingerprint(file: File): string {
  return `${file.name.toLowerCase().trim()}::${file.size}::${file.lastModified}`;
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
export function extractAudioDuration(file: File | Blob): Promise<number> {
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

  const fileName = file instanceof File ? file.name : '';
  if (isMp4File(fileName, file.type)) {
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

export async function importAudioFiles(
  rawFiles: File[],
  existingBooks: AudiobookRecord[],
  onProgress: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: [],
    duplicates: [],
    unsupportedCount: 0,
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

  // Request persistent storage proactively
  await requestPersistentStorage();

  const existingFingerprints = new Set(existingBooks.map((b) => b.fingerprint));
  const seenInBatch = new Set<string>();
  const filesToImport: File[] = [];

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
    if (existingFingerprints.has(fp) || seenInBatch.has(fp)) {
      result.duplicates.push(file.name);
      continue;
    }

    seenInBatch.add(fp);
    filesToImport.push(file);
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

  // Quota check with 5% headroom (at least 10 MB buffer)
  const totalBytesNeeded = filesToImport.reduce((acc, f) => acc + f.size, 0);
  const estimate = await getStorageEstimate();
  if (estimate.supported) {
    const safetyBuffer = Math.max(10 * 1024 * 1024, Math.round(totalBytesNeeded * 0.05));
    if (totalBytesNeeded + safetyBuffer > estimate.available) {
      result.insufficientStorage = {
        requiredBytes: totalBytesNeeded,
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
    const file = filesToImport[i];
    const baseOverall = (i / totalToImport) * 100;

    onProgress({
      phase: 'importing',
      totalFiles: totalToImport,
      processedFiles: i,
      currentFileName: file.name,
      currentFilePercent: 0,
      overallPercent: Math.round(baseOverall),
    });

    try {
      const id = generateId();
      const fingerprint = computeFileFingerprint(file);

      // Verify remaining space before each large file
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

      const [{ storageType, storageKey }, duration] = await Promise.all([
        saveAudioFile(id, file, (filePct) => {
          const overall = Math.round(((i + filePct / 100) / totalToImport) * 100);
          onProgress({
            phase: 'importing',
            totalFiles: totalToImport,
            processedFiles: i,
            currentFileName: file.name,
            currentFilePercent: filePct,
            overallPercent: Math.min(99, overall),
          });
        }),
        extractAudioDuration(file),
      ]);

      const record: AudiobookRecord = {
        id,
        fingerprint,
        originalName: file.name,
        customName: cleanAudiobookTitle(file.name),
        storageType,
        storageKey,
        fileSize: file.size,
        mimeType: file.type || (isMp4File(file.name, file.type) ? 'audio/mp4' : 'audio/mpeg'),
        lastModified: file.lastModified || Date.now(),
        duration,
        importedAt: Date.now() + i, // Preserve deterministic ordering within batch
        lastPlayedAt: null,
        currentTime: 0,
        playbackRate: 1.0,
        status: 'not_started',
      };

      await putAudiobook(record);
      result.imported.push(record);
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'QuotaExceededError'
          ? 'Espaço de armazenamento esgotado durante a cópia.'
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
