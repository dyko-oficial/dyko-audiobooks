import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AudiobookRecord, AudiobookStatus, PlaybackRate } from '../types/audiobook';
import { updateAudiobookFields, writeSyncCheckpoint } from '../storage/db';
import { getAudioFile } from '../storage/fileStorage';

const AUTO_SAVE_INTERVAL_MS = 5000;
const REWIND_SECONDS = 15;
const FORWARD_SECONDS = 30;

interface OpenAudiobookOptions {
  autoPlay?: boolean;
  restart?: boolean;
}

interface AudioControllerValue {
  activeBook: AudiobookRecord | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  playbackRate: PlaybackRate;
  error: string | null;
  openAudiobook: (book: AudiobookRecord, options?: OpenAudiobookOptions) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  togglePlayPause: () => Promise<void>;
  seekTo: (seconds: number) => void;
  seekBy: (deltaSeconds: number) => void;
  setPlaybackRate: (rate: PlaybackRate) => void;
  restartCurrentBook: () => Promise<void>;
  saveCurrentPosition: (forceStatus?: AudiobookStatus) => Promise<void>;
  syncActiveBookMeta: (updated: AudiobookRecord) => void;
  stopAndClearIfActive: (bookId: string | 'ALL') => void;
  clearError: () => void;
}

const AudioControllerContext = createContext<AudioControllerValue | null>(null);

interface AudioControllerProviderProps {
  children: React.ReactNode;
  onBookUpdated: (updated: AudiobookRecord) => void;
}

function clampPosition(pos: number, dur: number): number {
  if (!Number.isFinite(pos) || pos < 0) return 0;
  if (Number.isFinite(dur) && dur > 0) {
    return Math.min(pos, dur);
  }
  return pos;
}

export const AudioControllerProvider: React.FC<AudioControllerProviderProps> = ({
  children,
  onBookUpdated,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const activeBookRef = useRef<AudiobookRecord | null>(null);
  const onBookUpdatedRef = useRef(onBookUpdated);
  const lastSavedAtRef = useRef<number>(0);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingAutoPlayRef = useRef<boolean>(false);

  const [activeBook, setActiveBook] = useState<AudiobookRecord | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1.0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onBookUpdatedRef.current = onBookUpdated;
  }, [onBookUpdated]);

  // Ensure singleton HTMLAudioElement exists once for the lifetime of the app
  const getAudioElement = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = document.createElement('audio');
      el.preload = 'metadata';
      el.setAttribute('playsinline', 'true');
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const updateMediaSessionPosition = useCallback((el: HTMLAudioElement) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;

    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : activeBookRef.current?.duration ?? 0;
    if (!Number.isFinite(dur) || dur <= 0) return;

    const pos = clampPosition(el.currentTime, dur);
    const rate = Number.isFinite(el.playbackRate) && el.playbackRate > 0 ? el.playbackRate : 1;

    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: rate,
        position: pos,
      });
    } catch {
      // Ignore unsupported position state edge cases on certain browsers
    }
  }, []);

  const updateMediaSessionMetadata = useCallback((book: AudiobookRecord | null) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    if (!book) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }

    if (typeof MediaMetadata !== 'undefined') {
      const base = import.meta.env.BASE_URL || '/';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: book.customName,
        artist: 'Dyko Audiobooks',
        album: 'Biblioteca Local',
        artwork: [
          { src: `${base}pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
        ],
      });
    }
  }, []);

  const computeStatusForPosition = useCallback(
    (pos: number, dur: number, currentStatus: AudiobookStatus, forceStatus?: AudiobookStatus): AudiobookStatus => {
      if (forceStatus) return forceStatus;
      if (dur > 0 && pos >= dur - 2) return 'completed';
      if (pos > 0.5) return 'in_progress';
      if (currentStatus === 'completed') return 'completed';
      return currentStatus;
    },
    []
  );

  const writeCheckpointNow = useCallback(
    (forceStatus?: AudiobookStatus) => {
      const book = activeBookRef.current;
      const el = audioRef.current;
      if (!book || !el) return;

      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : book.duration;
      const pos = clampPosition(el.currentTime, dur);
      const status = computeStatusForPosition(pos, dur, book.status, forceStatus);
      const rate = (el.playbackRate || book.playbackRate || 1.0) as PlaybackRate;

      writeSyncCheckpoint({
        id: book.id,
        currentTime: Math.round(pos * 10) / 10,
        duration: dur,
        status,
        playbackRate: rate,
        updatedAt: Date.now(),
      });
    },
    [computeStatusForPosition]
  );

  const saveCurrentPosition = useCallback(
    async (forceStatus?: AudiobookStatus) => {
      const book = activeBookRef.current;
      const el = audioRef.current;
      if (!book || !el) return;

      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : book.duration;
      const rawPos = forceStatus === 'completed' && dur > 0 ? dur : el.currentTime;
      const pos = Math.round(clampPosition(rawPos, dur) * 10) / 10;
      const status = computeStatusForPosition(pos, dur, book.status, forceStatus);
      const rate = (el.playbackRate || book.playbackRate || 1.0) as PlaybackRate;
      const now = Date.now();

      writeSyncCheckpoint({
        id: book.id,
        currentTime: pos,
        duration: dur,
        status,
        playbackRate: rate,
        updatedAt: now,
      });

      lastSavedAtRef.current = now;

      try {
        const updated = await updateAudiobookFields(book.id, {
          currentTime: pos,
          duration: dur,
          status,
          playbackRate: rate,
          lastPlayedAt: now,
        });
        if (updated) {
          activeBookRef.current = updated;
          setActiveBook(updated);
          onBookUpdatedRef.current(updated);
        }
      } catch {
        // Keep sync checkpoint as safety net if IndexedDB write fails
      }
    },
    [computeStatusForPosition]
  );

  const play = useCallback(async () => {
    const el = getAudioElement();
    const book = activeBookRef.current;
    if (!book || !el.src) return;

    setError(null);
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : book.duration;
    // If book was completed and sits at the end, restart smoothly from 0
    if ((book.status === 'completed' || (dur > 0 && el.currentTime >= dur - 2)) && dur > 0) {
      el.currentTime = 0;
      setCurrentTime(0);
    }

    try {
      await el.play();
      updateMediaSessionPosition(el);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Toque no botão reproduzir para iniciar o áudio.');
      } else {
        setError('Não foi possível iniciar a reprodução deste arquivo de áudio.');
      }
    }
  }, [getAudioElement, updateMediaSessionPosition]);

  const pause = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    void saveCurrentPosition();
  }, [saveCurrentPosition]);

  const togglePlayPause = useCallback(async () => {
    const el = audioRef.current;
    if (!el || !activeBookRef.current) return;
    if (el.paused) {
      await play();
    } else {
      pause();
    }
  }, [play, pause]);

  const seekTo = useCallback(
    (seconds: number) => {
      const el = audioRef.current;
      const book = activeBookRef.current;
      if (!el || !book) return;

      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : book.duration;
      const clamped = clampPosition(seconds, dur);
      el.currentTime = clamped;
      setCurrentTime(clamped);
      updateMediaSessionPosition(el);
      const nextStatus: AudiobookStatus =
        dur > 0 && clamped >= dur - 1 ? 'completed' : clamped > 0 ? 'in_progress' : 'not_started';
      void saveCurrentPosition(nextStatus);
    },
    [saveCurrentPosition, updateMediaSessionPosition]
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const el = audioRef.current;
      if (!el || !activeBookRef.current) return;
      seekTo(el.currentTime + deltaSeconds);
    },
    [seekTo]
  );

  const setPlaybackRate = useCallback(
    (rate: PlaybackRate) => {
      const el = audioRef.current;
      const book = activeBookRef.current;
      setPlaybackRateState(rate);
      if (el) {
        el.playbackRate = rate;
        updateMediaSessionPosition(el);
      }
      if (book) {
        const updatedBook: AudiobookRecord = { ...book, playbackRate: rate };
        activeBookRef.current = updatedBook;
        setActiveBook(updatedBook);
        void updateAudiobookFields(book.id, { playbackRate: rate }).then((saved) => {
          if (saved) {
            activeBookRef.current = saved;
            setActiveBook(saved);
            onBookUpdatedRef.current(saved);
          }
        });
      }
    },
    [updateMediaSessionPosition]
  );

  const restartCurrentBook = useCallback(async () => {
    const el = audioRef.current;
    const book = activeBookRef.current;
    if (!el || !book) return;

    setError(null);
    el.currentTime = 0;
    setCurrentTime(0);
    await saveCurrentPosition('in_progress');
    await play();
  }, [play, saveCurrentPosition]);

  const openAudiobook = useCallback(
    async (book: AudiobookRecord, options: OpenAudiobookOptions = {}) => {
      const el = getAudioElement();
      const { autoPlay = false, restart = false } = options;

      // If same book is already loaded and no restart requested, keep playback uninterrupted
      if (activeBookRef.current?.id === book.id && el.src && !restart) {
        if (autoPlay && el.paused) {
          await play();
        }
        return;
      }

      // Persist previous audiobook position before switching
      if (activeBookRef.current && activeBookRef.current.id !== book.id) {
        await saveCurrentPosition();
      }

      setError(null);
      setIsLoading(true);

      // Pause and release previous Object URL
      el.pause();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      try {
        const fileBlob = await getAudioFile(book.storageType, book.storageKey);
        if (!fileBlob) {
          setIsLoading(false);
          setIsPlaying(false);
          activeBookRef.current = book;
          setActiveBook(book);
          setCurrentTime(book.currentTime);
          setDuration(book.duration);
          setPlaybackRateState(book.playbackRate || 1.0);
          setError('Arquivo de áudio indisponível no armazenamento local. Remova e importe novamente.');
          return;
        }

        const nextUrl = URL.createObjectURL(fileBlob);
        objectUrlRef.current = nextUrl;

        const targetRate = (book.playbackRate || 1.0) as PlaybackRate;
        const targetSeek = restart ? 0 : Math.max(0, book.currentTime || 0);

        activeBookRef.current = book;
        setActiveBook(book);
        setDuration(book.duration || 0);
        setCurrentTime(targetSeek);
        setPlaybackRateState(targetRate);
        setIsPlaying(false);

        pendingSeekRef.current = targetSeek;
        pendingAutoPlayRef.current = autoPlay || restart;

        updateMediaSessionMetadata(book);

        el.src = nextUrl;
        el.playbackRate = targetRate;
        el.load();

        if (restart) {
          const updated = await updateAudiobookFields(book.id, {
            currentTime: 0,
            status: 'in_progress',
            lastPlayedAt: Date.now(),
          });
          if (updated) {
            activeBookRef.current = updated;
            setActiveBook(updated);
            onBookUpdatedRef.current(updated);
          }
        }
      } catch {
        setIsLoading(false);
        setError('Erro ao carregar o arquivo de áudio armazenado localmente.');
      }
    },
    [getAudioElement, play, saveCurrentPosition, updateMediaSessionMetadata]
  );

  const syncActiveBookMeta = useCallback(
    (updated: AudiobookRecord) => {
      if (activeBookRef.current?.id === updated.id) {
        activeBookRef.current = updated;
        setActiveBook(updated);
        updateMediaSessionMetadata(updated);
      }
    },
    [updateMediaSessionMetadata]
  );

  const stopAndClearIfActive = useCallback(
    (bookId: string | 'ALL') => {
      const current = activeBookRef.current;
      if (!current) return;
      if (bookId !== 'ALL' && current.id !== bookId) return;

      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      activeBookRef.current = null;
      setActiveBook(null);
      setIsPlaying(false);
      setIsLoading(false);
      setCurrentTime(0);
      setDuration(0);
      setError(null);
      updateMediaSessionMetadata(null);
    },
    [updateMediaSessionMetadata]
  );

  const clearError = useCallback(() => setError(null), []);

  // Wire singleton HTMLAudioElement listeners once
  useEffect(() => {
    const el = getAudioElement();

    const handleLoadedMetadata = () => {
      const realDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      const book = activeBookRef.current;

      if (realDuration > 0) {
        setDuration(realDuration);
        if (book && (!book.duration || Math.abs(book.duration - realDuration) > 1)) {
          void updateAudiobookFields(book.id, { duration: realDuration }).then((updated) => {
            if (updated && activeBookRef.current?.id === updated.id) {
              activeBookRef.current = updated;
              setActiveBook(updated);
              onBookUpdatedRef.current(updated);
            }
          });
        }
      }

      if (pendingSeekRef.current !== null) {
        const target = clampPosition(pendingSeekRef.current, realDuration);
        pendingSeekRef.current = null;
        if (target > 0) {
          try {
            el.currentTime = target;
            setCurrentTime(target);
          } catch {
            // Seek will retry on canplay if needed
          }
        }
      }

      if (book) {
        el.playbackRate = book.playbackRate || 1.0;
      }

      setIsLoading(false);
      updateMediaSessionPosition(el);

      if (pendingAutoPlayRef.current) {
        pendingAutoPlayRef.current = false;
        void el.play().catch(() => {
          // Autoplay blocked by browser policy; user can tap Play directly
        });
      }
    };

    const handleTimeUpdate = () => {
      const pos = el.currentTime;
      setCurrentTime(pos);

      const now = Date.now();
      if (!el.paused && now - lastSavedAtRef.current >= AUTO_SAVE_INTERVAL_MS) {
        lastSavedAtRef.current = now;
        void saveCurrentPosition('in_progress');
        updateMediaSessionPosition(el);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      setError(null);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      updateMediaSessionPosition(el);
      void saveCurrentPosition('in_progress');
    };

    const handlePause = () => {
      setIsPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      updateMediaSessionPosition(el);
      if (!el.ended) {
        void saveCurrentPosition();
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : activeBookRef.current?.duration ?? 0;
      setCurrentTime(dur);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      updateMediaSessionPosition(el);
      void saveCurrentPosition('completed');
    };

    const handleWaiting = () => {
      setIsLoading(true);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    const handleAudioError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      const mediaErr = el.error;
      if (mediaErr) {
        if (mediaErr.code === MediaError.MEDIA_ERR_DECODE || mediaErr.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          setError('Formato de áudio incompatível ou arquivo corrompido.');
        } else {
          setError('Ocorreu um erro durante a reprodução do audiolivro.');
        }
      }
    };

    el.addEventListener('loadedmetadata', handleLoadedMetadata);
    el.addEventListener('timeupdate', handleTimeUpdate);
    el.addEventListener('play', handlePlay);
    el.addEventListener('pause', handlePause);
    el.addEventListener('ended', handleEnded);
    el.addEventListener('waiting', handleWaiting);
    el.addEventListener('canplay', handleCanPlay);
    el.addEventListener('error', handleAudioError);

    return () => {
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
      el.removeEventListener('timeupdate', handleTimeUpdate);
      el.removeEventListener('play', handlePlay);
      el.removeEventListener('pause', handlePause);
      el.removeEventListener('ended', handleEnded);
      el.removeEventListener('waiting', handleWaiting);
      el.removeEventListener('canplay', handleCanPlay);
      el.removeEventListener('error', handleAudioError);
    };
  }, [getAudioElement, saveCurrentPosition, updateMediaSessionPosition]);

  // Register Android Media Session controls
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;
    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Browser does not support this specific action
      }
    };

    safeSetHandler('play', () => {
      void play();
    });
    safeSetHandler('pause', () => {
      pause();
    });
    safeSetHandler('seekbackward', (details) => {
      const offset = details?.seekOffset && details.seekOffset > 0 ? details.seekOffset : REWIND_SECONDS;
      seekBy(-offset);
    });
    safeSetHandler('seekforward', (details) => {
      const offset = details?.seekOffset && details.seekOffset > 0 ? details.seekOffset : FORWARD_SECONDS;
      seekBy(offset);
    });
    safeSetHandler('seekto', (details) => {
      if (details && typeof details.seekTime === 'number') {
        seekTo(details.seekTime);
      }
    });
    safeSetHandler('stop', () => {
      pause();
    });

    return () => {
      safeSetHandler('play', null);
      safeSetHandler('pause', null);
      safeSetHandler('seekbackward', null);
      safeSetHandler('seekforward', null);
      safeSetHandler('seekto', null);
      safeSetHandler('stop', null);
    };
  }, [play, pause, seekBy, seekTo]);

  // Mobile lifecycle persistence: visibilitychange, pagehide, freeze, beforeunload
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        writeCheckpointNow();
        void saveCurrentPosition();
      }
    };

    const handlePageHide = () => {
      writeCheckpointNow();
      void saveCurrentPosition();
    };

    const handleBeforeUnload = () => {
      writeCheckpointNow();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('freeze', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('freeze', handlePageHide);
    };
  }, [saveCurrentPosition, writeCheckpointNow]);

  // Cleanup Object URL on true provider unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  return (
    <AudioControllerContext.Provider
      value={{
        activeBook,
        isPlaying,
        isLoading,
        currentTime,
        duration,
        playbackRate,
        error,
        openAudiobook,
        play,
        pause,
        togglePlayPause,
        seekTo,
        seekBy,
        setPlaybackRate,
        restartCurrentBook,
        saveCurrentPosition,
        syncActiveBookMeta,
        stopAndClearIfActive,
        clearError,
      }}
    >
      {children}
    </AudioControllerContext.Provider>
  );
};

export function useAudioController(): AudioControllerValue {
  const ctx = useContext(AudioControllerContext);
  if (!ctx) {
    throw new Error('useAudioController deve ser usado dentro de AudioControllerProvider.');
  }
  return ctx;
}
