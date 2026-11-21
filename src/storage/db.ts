import type { AudiobookRecord, PlaybackCheckpoint } from '../types/audiobook';

const DB_NAME = 'dyko-audiobooks-db';
const DB_VERSION = 1;
const STORE_BOOKS = 'audiobooks';
const STORE_BLOBS = 'audioBlobs';
const CHECKPOINT_STORAGE_KEY = 'dyko_audiobooks_checkpoint_v1';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB não está disponível neste navegador.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        const booksStore = db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
        booksStore.createIndex('fingerprint', 'fingerprint', { unique: false });
        booksStore.createIndex('importedAt', 'importedAt', { unique: false });
        booksStore.createIndex('lastPlayedAt', 'lastPlayedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Falha ao abrir o banco de dados local.'));
    };
  });

  return dbPromise;
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = executor(store);

        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        req.onerror = () => {
          reject(req.error ?? new Error('Erro na operação do banco de dados local.'));
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error('Erro ao concluir transação local.'));
        tx.onabort = () => reject(tx.error ?? new Error('Transação local interrompida.'));
      })
  );
}

export async function getAllAudiobooks(): Promise<AudiobookRecord[]> {
  const records = await runTransaction<AudiobookRecord[]>(STORE_BOOKS, 'readonly', (store) =>
    store.getAll()
  );
  return records ?? [];
}

export async function getAudiobookById(id: string): Promise<AudiobookRecord | undefined> {
  return runTransaction<AudiobookRecord | undefined>(STORE_BOOKS, 'readonly', (store) =>
    store.get(id)
  );
}

export async function putAudiobook(record: AudiobookRecord): Promise<void> {
  await runTransaction(STORE_BOOKS, 'readwrite', (store) => store.put(record));
}

export async function updateAudiobookFields(
  id: string,
  patch: Partial<Omit<AudiobookRecord, 'id'>>
): Promise<AudiobookRecord | null> {
  const existing = await getAudiobookById(id);
  if (!existing) return null;
  const updated: AudiobookRecord = {
    ...existing,
    ...patch,
  };
  await putAudiobook(updated);
  return updated;
}

export async function deleteAudiobookRecord(id: string): Promise<void> {
  await runTransaction(STORE_BOOKS, 'readwrite', (store) => store.delete(id));
  const checkpoint = readSyncCheckpoint();
  if (checkpoint && checkpoint.id === id) {
    clearSyncCheckpoint();
  }
}

export async function clearAllAudiobookRecords(): Promise<void> {
  await runTransaction(STORE_BOOKS, 'readwrite', (store) => store.clear());
  clearSyncCheckpoint();
}

// IndexedDB Blob fallback store (used only when OPFS createWritable is unavailable)
interface StoredAudioBlob {
  id: string;
  blob: Blob;
}

export async function putAudioBlob(id: string, blob: Blob): Promise<void> {
  const entry: StoredAudioBlob = { id, blob };
  await runTransaction(STORE_BLOBS, 'readwrite', (store) => store.put(entry));
}

export async function getAudioBlob(id: string): Promise<Blob | null> {
  const entry = await runTransaction<StoredAudioBlob | undefined>(STORE_BLOBS, 'readonly', (store) =>
    store.get(id)
  );
  return entry?.blob ?? null;
}

export async function deleteAudioBlob(id: string): Promise<void> {
  await runTransaction(STORE_BLOBS, 'readwrite', (store) => store.delete(id));
}

export async function clearAllAudioBlobs(): Promise<void> {
  await runTransaction(STORE_BLOBS, 'readwrite', (store) => store.clear());
}

/**
 * Synchronous minimal checkpoint mirror in localStorage (ONLY tiny numeric metadata, NEVER audio data).
 * Protects playback position when Android abruptly terminates the PWA process during pagehide/beforeunload.
 */
export function writeSyncCheckpoint(checkpoint: PlaybackCheckpoint): void {
  try {
    window.localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(checkpoint));
  } catch {
    // Ignore quota/privacy restrictions for this secondary mirror
  }
}

export function readSyncCheckpoint(): PlaybackCheckpoint | null {
  try {
    const raw = window.localStorage.getItem(CHECKPOINT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaybackCheckpoint;
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.currentTime === 'number' &&
      Number.isFinite(parsed.currentTime)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearSyncCheckpoint(): void {
  try {
    window.localStorage.removeItem(CHECKPOINT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Reconciles any crash-safe synchronous checkpoint saved on abrupt app termination
 * into the primary IndexedDB record on next launch.
 */
export async function reconcilePendingCheckpoint(books: AudiobookRecord[]): Promise<AudiobookRecord[]> {
  const checkpoint = readSyncCheckpoint();
  if (!checkpoint) return books;

  const target = books.find((b) => b.id === checkpoint.id);
  if (!target) {
    clearSyncCheckpoint();
    return books;
  }

  const lastKnownPlayed = target.lastPlayedAt ?? 0;
  if (checkpoint.updatedAt > lastKnownPlayed || Math.abs(checkpoint.currentTime - target.currentTime) > 1.5) {
    const merged: AudiobookRecord = {
      ...target,
      currentTime: checkpoint.currentTime,
      duration: checkpoint.duration > 0 ? checkpoint.duration : target.duration,
      status: checkpoint.status,
      playbackRate: checkpoint.playbackRate || target.playbackRate,
      lastPlayedAt: Math.max(lastKnownPlayed, checkpoint.updatedAt),
    };
    try {
      await putAudiobook(merged);
      clearSyncCheckpoint();
      return books.map((b) => (b.id === merged.id ? merged : b));
    } catch {
      return books;
    }
  }

  clearSyncCheckpoint();
  return books;
}
