import type { AudioStorageType, StorageEstimateInfo } from '../types/audiobook';
import { clearAllAudioBlobs, deleteAudioBlob, getAudioBlob, putAudioBlob } from './db';

const OPFS_DIR_NAME = 'audiobooks';

let opfsSupportedCache: boolean | null = null;

async function getOpfsAudiobooksDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
}

export async function isOpfsWritableSupported(): Promise<boolean> {
  if (opfsSupportedCache !== null) return opfsSupportedCache;

  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.storage ||
      typeof navigator.storage.getDirectory !== 'function'
    ) {
      opfsSupportedCache = false;
      return false;
    }

    const dir = await getOpfsAudiobooksDir();
    const probeName = '__dyko_probe.tmp';
    const probeHandle = await dir.getFileHandle(probeName, { create: true });
    const canWrite = typeof probeHandle.createWritable === 'function';
    if (canWrite) {
      const writable = await probeHandle.createWritable();
      await writable.close();
    }
    await dir.removeEntry(probeName).catch(() => {});
    opfsSupportedCache = canWrite;
    return canWrite;
  } catch {
    opfsSupportedCache = false;
    return false;
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (typeof navigator.storage.persisted === 'function') {
        const alreadyPersisted = await navigator.storage.persisted();
        if (alreadyPersisted) return true;
      }
      if (typeof navigator.storage.persist === 'function') {
        return await navigator.storage.persist();
      }
    }
  } catch {
    // Some browsers deny persist silently
  }
  return false;
}

export async function getStorageEstimate(): Promise<StorageEstimateInfo> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      const [estimate, persisted] = await Promise.all([
        navigator.storage.estimate(),
        typeof navigator.storage.persisted === 'function'
          ? navigator.storage.persisted().catch(() => false)
          : Promise.resolve(false),
      ]);
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      return {
        usage,
        quota,
        available: Math.max(0, quota - usage),
        persisted,
        supported: quota > 0,
      };
    }
  } catch {
    // Fall through to unsupported state
  }

  return {
    usage: 0,
    quota: 0,
    available: 0,
    persisted: false,
    supported: false,
  };
}

/**
 * Streams a potentially multi-hour audio/MP4 file into OPFS in small chunks without
 * loading the entire file into RAM. Falls back to IndexedDB Blob storage if OPFS
 * writable streams are unavailable.
 */
export async function saveAudioFile(
  id: string,
  file: Blob,
  fileName: string,
  onProgress?: (percent: number) => void,
  overrideExt?: string
): Promise<{ storageType: AudioStorageType; storageKey: string }> {
  const useOpfs = await isOpfsWritableSupported();

  if (useOpfs) {
    const lowerName = fileName.toLowerCase();
    const ext =
      overrideExt ??
      (lowerName.endsWith('.mp3')
        ? '.mp3'
        : lowerName.endsWith('.m4a')
          ? '.m4a'
          : lowerName.endsWith('.mp4')
            ? '.mp4'
            : '.audio');
    const storageKey = `${id}${ext}`;
    const dir = await getOpfsAudiobooksDir();
    const fileHandle = await dir.getFileHandle(storageKey, { create: true });
    const writable = await fileHandle.createWritable();

    try {
      const totalBytes = file.size || 1;
      if (typeof file.stream === 'function') {
        const reader = file.stream().getReader();
        let writtenBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            await writable.write(value);
            writtenBytes += value.byteLength;
            if (onProgress) {
              onProgress(Math.min(99, Math.round((writtenBytes / totalBytes) * 100)));
            }
          }
        }
      } else {
        const CHUNK_SIZE = 4 * 1024 * 1024;
        let offset = 0;
        while (offset < file.size) {
          const slice = file.slice(offset, offset + CHUNK_SIZE);
          await writable.write(slice);
          offset += slice.size;
          if (onProgress) {
            onProgress(Math.min(99, Math.round((offset / totalBytes) * 100)));
          }
        }
      }

      await writable.close();
      onProgress?.(100);
      return { storageType: 'opfs', storageKey };
    } catch (err) {
      await writable.abort().catch(() => {});
      await dir.removeEntry(storageKey).catch(() => {});
      throw err;
    }
  }

  onProgress?.(15);
  await putAudioBlob(id, file);
  onProgress?.(100);
  return { storageType: 'idb', storageKey: id };
}

/**
 * Opens a streaming writer directly to OPFS (or collects Blob parts for IndexedDB fallback)
 * so the lossless MP4 remuxer can write audio-only chunks without buffering the whole file.
 */
export async function saveAudioFromWriter<T>(
  id: string,
  ext: string,
  mimeType: string,
  runWriter: (writeChunk: (chunk: Uint8Array) => Promise<void>) => Promise<T>
): Promise<{
  storageType: AudioStorageType;
  storageKey: string;
  bytesWritten: number;
  writerResult: T;
}> {
  const useOpfs = await isOpfsWritableSupported();

  if (useOpfs) {
    const storageKey = `${id}${ext}`;
    const dir = await getOpfsAudiobooksDir();
    const fileHandle = await dir.getFileHandle(storageKey, { create: true });
    const writable = await fileHandle.createWritable();
    let bytesWritten = 0;

    try {
      const writerResult = await runWriter(async (chunk) => {
        if (chunk.byteLength === 0) return;
        const payload = chunk.slice();
        await writable.write(payload);
        bytesWritten += payload.byteLength;
      });
      await writable.close();
      return {
        storageType: 'opfs',
        storageKey,
        bytesWritten,
        writerResult,
      };
    } catch (err) {
      await writable.abort().catch(() => {});
      await dir.removeEntry(storageKey).catch(() => {});
      throw err;
    }
  }

  // Fallback for browsers without OPFS createWritable: assemble Blob in IndexedDB
  const parts: BlobPart[] = [];
  let bytesWritten = 0;
  const writerResult = await runWriter(async (chunk) => {
    if (chunk.byteLength === 0) return;
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    parts.push(copy.buffer);
    bytesWritten += chunk.byteLength;
  });

  if (bytesWritten > 0) {
    const blob = new Blob(parts, { type: mimeType });
    await putAudioBlob(id, blob);
  }

  return {
    storageType: 'idb',
    storageKey: id,
    bytesWritten,
    writerResult,
  };
}

/**
 * Retrieves a disk-backed File/Blob reference suitable for URL.createObjectURL().
 * Does not load the full audio into RAM.
 */
export async function getAudioFile(
  storageType: AudioStorageType,
  storageKey: string
): Promise<File | Blob | null> {
  if (storageType === 'opfs') {
    try {
      const dir = await getOpfsAudiobooksDir();
      const handle = await dir.getFileHandle(storageKey);
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  try {
    return await getAudioBlob(storageKey);
  } catch {
    return null;
  }
}

export async function deleteAudioFile(
  storageType: AudioStorageType,
  storageKey: string
): Promise<void> {
  if (storageType === 'opfs') {
    try {
      const dir = await getOpfsAudiobooksDir();
      await dir.removeEntry(storageKey);
    } catch {
      // Entry may already be missing
    }
    return;
  }

  try {
    await deleteAudioBlob(storageKey);
  } catch {
    // Ignore missing entry
  }
}

export async function clearAllAudioFiles(): Promise<void> {
  try {
    const canOpfs = await isOpfsWritableSupported();
    if (canOpfs) {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(OPFS_DIR_NAME, { recursive: true }).catch(() => {});
    }
  } catch {
    // Ignore OPFS cleanup failures
  }

  await clearAllAudioBlobs().catch(() => {});
}
