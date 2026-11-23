import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AudiobookRecord } from './types/audiobook';
import {
  clearAllAudiobookRecords,
  deleteAudiobookRecord,
  getAllAudiobooks,
  getAudiobookById,
  reconcilePendingCheckpoint,
  updateAudiobookFields,
} from './storage/db';
import { clearAllAudioFiles, deleteAudioFile } from './storage/fileStorage';
import { optimizeExistingAudiobook } from './import/importManager';
import { formatFileSize } from './utils/format';
import { AudioControllerProvider, useAudioController } from './playback/audioController';
import { OfflineBanner } from './components/OfflineBanner';
import { ImportView } from './components/ImportView';
import { LibraryView, type OptimizationProgressState } from './components/LibraryView';
import { MiniPlayer } from './components/MiniPlayer';
import { PlayerView } from './components/PlayerView';
import { ConfirmDialog, RenameDialog } from './components/Dialogs';

type ActiveScreen = 'library' | 'player';

interface AppShellProps {
  books: AudiobookRecord[];
  isLoadingBooks: boolean;
  loadError: string | null;
  onRetryLoad: () => void;
  onBooksAdded: (newBooks: AudiobookRecord[]) => void;
  onBookReplaced: (updated: AudiobookRecord) => void;
  onBookRemoved: (bookId: string) => void;
  onAllBooksCleared: () => void;
}

const AppShell: React.FC<AppShellProps> = ({
  books,
  isLoadingBooks,
  loadError,
  onRetryLoad,
  onBooksAdded,
  onBookReplaced,
  onBookRemoved,
  onAllBooksCleared,
}) => {
  const {
    activeBook,
    openAudiobook,
    saveCurrentPosition,
    syncActiveBookMeta,
    stopAndClearIfActive,
  } = useAudioController();

  const [screen, setScreen] = useState<ActiveScreen>('library');
  const [showImportModal, setShowImportModal] = useState(false);
  const [renamingBook, setRenamingBook] = useState<AudiobookRecord | null>(null);
  const [deletingBook, setDeletingBook] = useState<AudiobookRecord | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [optimizationProgress, setOptimizationProgress] =
    useState<OptimizationProgressState | null>(null);

  const handleSelectBook = (book: AudiobookRecord) => {
    setActionError(null);
    setScreen('player');
    void openAudiobook(book, { autoPlay: book.status !== 'completed' });
  };

  const handleRenameConfirm = async (bookId: string, newName: string) => {
    setActionError(null);
    try {
      const updated = await updateAudiobookFields(bookId, { customName: newName });
      if (updated) {
        onBookReplaced(updated);
        syncActiveBookMeta(updated);
      }
      setRenamingBook(null);
    } catch {
      setActionError('Não foi possível salvar o novo nome do audiolivro.');
    }
  };

  const handleMarkCompleted = async (book: AudiobookRecord) => {
    setActionError(null);
    try {
      const finalPos = book.duration > 0 ? book.duration : book.currentTime;
      const updated = await updateAudiobookFields(book.id, {
        status: 'completed',
        currentTime: finalPos,
        lastPlayedAt: Date.now(),
      });
      if (updated) {
        onBookReplaced(updated);
        syncActiveBookMeta(updated);
      }
    } catch {
      setActionError('Não foi possível atualizar o estado do audiolivro.');
    }
  };

  const handleRestartBook = async (book: AudiobookRecord) => {
    setActionError(null);
    try {
      const updated = await updateAudiobookFields(book.id, {
        status: 'in_progress',
        currentTime: 0,
        lastPlayedAt: Date.now(),
      });
      const nextBook = updated ?? { ...book, status: 'in_progress' as const, currentTime: 0 };
      onBookReplaced(nextBook);
      syncActiveBookMeta(nextBook);
      setScreen('player');
      await openAudiobook(nextBook, { autoPlay: true, restart: true });
    } catch {
      setActionError('Não foi possível reiniciar o audiolivro.');
    }
  };

  const handleConfirmDeleteSingle = async () => {
    if (!deletingBook || isDeleting) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      stopAndClearIfActive(deletingBook.id);
      await deleteAudioFile(deletingBook.storageType, deletingBook.storageKey);
      await deleteAudiobookRecord(deletingBook.id);
      onBookRemoved(deletingBook.id);
      if (activeBook?.id === deletingBook.id) {
        setScreen('library');
      }
      setDeletingBook(null);
    } catch {
      setActionError('Erro ao remover o audiolivro do armazenamento local.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteAll = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      stopAndClearIfActive('ALL');
      await clearAllAudioFiles();
      await clearAllAudiobookRecords();
      onAllBooksCleared();
      setScreen('library');
      setConfirmDeleteAll(false);
    } catch {
      setActionError('Erro ao limpar a biblioteca local.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOptimizeBooks = async (targets: AudiobookRecord[]) => {
    if (targets.length === 0 || optimizationProgress) return;

    setActionError(null);
    setImportNotice(null);

    let optimizedSuccess = 0;
    let totalSavedBytes = 0;
    const failedMessages: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      let target = targets[i];

      // If this audiobook is currently loaded in the audio element, save its exact timestamp
      // and release its file handle before replacing the underlying OPFS/IDB file.
      if (activeBook?.id === target.id) {
        await saveCurrentPosition();
        const latest = await getAudiobookById(target.id);
        if (latest) target = latest;
        stopAndClearIfActive(target.id);
      }

      setOptimizationProgress({
        currentIndex: i + 1,
        total: targets.length,
        currentTitle: target.customName,
        percent: 0,
      });

      try {
        const res = await optimizeExistingAudiobook(target, (percent) => {
          setOptimizationProgress({
            currentIndex: i + 1,
            total: targets.length,
            currentTitle: target.customName,
            percent,
          });
        });

        onBookReplaced(res.updated);
        optimizedSuccess += 1;
        totalSavedBytes += res.savedBytes;
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : 'Estrutura MP4 incompatível com a otimização.';
        failedMessages.push(`${target.customName}: ${reason}`);
      }
    }

    setOptimizationProgress(null);

    if (optimizedSuccess > 0) {
      const savedText =
        totalSavedBytes > 1024 * 1024 ? ` (${formatFileSize(totalSavedBytes)} liberados)` : '';
      setImportNotice(
        optimizedSuccess === 1
          ? `1 audiolivro MP4 otimizado para segundo plano com seu progresso mantido${savedText}.`
          : `${optimizedSuccess} audiolivros MP4 otimizados para segundo plano com o progresso mantido${savedText}.`
      );
    }

    if (failedMessages.length > 0) {
      setActionError(
        `Não foi possível otimizar ${failedMessages.length === 1 ? '1 arquivo' : `${failedMessages.length} arquivos`} (a cópia original e o progresso foram mantidos): ${failedMessages.join('; ')}`
      );
    }
  };

  if (isLoadingBooks) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-[#11161C] px-6">
        <Loader2 className="w-7 h-7 text-[#E0A458] animate-spin" aria-hidden="true" />
        <p className="text-sm text-[#96A2AE]">Carregando biblioteca local...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#11161C] px-5">
        <div className="w-full max-w-md rounded-2xl bg-[#182028] border border-[#2A3642] p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#E06C75] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h1 className="font-display text-lg font-medium text-[#EDE9E0]">
                Erro ao recuperar dados locais
              </h1>
              <p className="mt-1.5 text-sm text-[#96A2AE] leading-relaxed">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRetryLoad}
            className="w-full min-h-[44px] rounded-xl bg-[#E0A458] text-[#11161C] text-sm font-semibold hover:bg-[#ECB56F] transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // First-run screen when no audiobooks exist yet
  if (books.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-[#11161C]">
        <OfflineBanner />
        <ImportView
          existingBooks={books}
          onImportComplete={(imported, summary) => {
            onBooksAdded(imported);
            const parts: string[] = [
              imported.length === 1
                ? '1 audiolivro importado com sucesso.'
                : `${imported.length} audiolivros importados com sucesso.`,
            ];
            if (summary.optimizedCount > 0) {
              parts.push(
                summary.optimizedCount === 1
                  ? '1 MP4 otimizado sem vídeo para segundo plano.'
                  : `${summary.optimizedCount} MP4s otimizados sem vídeo para segundo plano.`
              );
            }
            if (summary.unsupportedCount > 0) {
              parts.push(`${summary.unsupportedCount} arquivo(s) não suportado(s) ignorado(s).`);
            }
            if (summary.duplicates.length > 0) {
              parts.push(`${summary.duplicates.length} já estava(m) na biblioteca.`);
            }
            if (summary.warnings.length > 0) {
              setActionError(
                summary.warnings.map((w) => `${w.fileName}: ${w.message}`).join('; ')
              );
            }
            setImportNotice(parts.join(' '));
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#11161C]">
      <OfflineBanner />

      {importNotice && screen === 'library' && (
        <div
          role="status"
          aria-live="polite"
          className="bg-[#182028] border-b border-[#2A3642] px-4 py-2.5 text-xs text-[#EDE9E0]"
        >
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <span>{importNotice}</span>
            <button
              type="button"
              onClick={() => setImportNotice(null)}
              className="text-[#E0A458] font-medium shrink-0 px-2 py-1"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="bg-[#212B36] border-b border-[#E06C75]/45 px-4 py-2.5 text-xs text-[#EDE9E0]"
        >
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-[#E0A458] font-medium shrink-0 px-2 py-1"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {screen === 'player' && activeBook ? (
        <PlayerView
          onBackToLibrary={() => setScreen('library')}
          onRequestRename={(book) => setRenamingBook(book)}
          onMarkCompleted={(book) => void handleMarkCompleted(book)}
        />
      ) : (
        <>
          <LibraryView
            books={books}
            onSelectBook={handleSelectBook}
            onOpenImport={() => setShowImportModal(true)}
            onRequestRename={(book) => setRenamingBook(book)}
            onMarkCompleted={(book) => void handleMarkCompleted(book)}
            onRestartBook={(book) => void handleRestartBook(book)}
            onRequestDeleteBook={(book) => setDeletingBook(book)}
            onRequestDeleteAll={() => setConfirmDeleteAll(true)}
            onOptimizeBooks={(targets) => void handleOptimizeBooks(targets)}
            optimizationProgress={optimizationProgress}
          />
          <MiniPlayer onOpenPlayer={() => setScreen('player')} />
        </>
      )}

      {showImportModal && (
        <ImportView
          isModal
          existingBooks={books}
          onImportComplete={(imported) => {
            onBooksAdded(imported);
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}

      <RenameDialog
        book={renamingBook}
        onCancel={() => setRenamingBook(null)}
        onConfirm={handleRenameConfirm}
      />

      <ConfirmDialog
        open={Boolean(deletingBook)}
        title="Remover audiolivro"
        description={
          deletingBook
            ? `A cópia local de "${deletingBook.customName}" e seu progresso salvo serão removidos do aplicativo. O arquivo original do seu dispositivo não será excluído.`
            : ''
        }
        confirmLabel="Remover"
        isBusy={isDeleting}
        onCancel={() => setDeletingBook(null)}
        onConfirm={() => void handleConfirmDeleteSingle()}
      />

      <ConfirmDialog
        open={confirmDeleteAll}
        title="Remover todos os audiolivros"
        description={`Todas as ${books.length} cópias armazenadas neste aplicativo e seus respectivos históricos de reprodução serão removidos. Os arquivos originais do celular permanecerão intactos.`}
        confirmLabel="Remover todos"
        isBusy={isDeleting}
        onCancel={() => setConfirmDeleteAll(false)}
        onConfirm={() => void handleConfirmDeleteAll()}
      />
    </div>
  );
};

export default function App() {
  const [books, setBooks] = useState<AudiobookRecord[]>([]);
  const [isLoadingBooks, setIsLoadingBooks] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    setIsLoadingBooks(true);
    setLoadError(null);
    try {
      const stored = await getAllAudiobooks();
      const reconciled = await reconcilePendingCheckpoint(stored);
      setBooks(reconciled);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Não foi possível acessar o armazenamento local (IndexedDB) deste navegador.'
      );
    } finally {
      setIsLoadingBooks(false);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const handleBookUpdated = useCallback((updated: AudiobookRecord) => {
    setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  }, []);

  const handleBooksAdded = useCallback((newBooks: AudiobookRecord[]) => {
    setBooks((prev) => {
      const existingIds = new Set(prev.map((b) => b.id));
      const uniqueNew = newBooks.filter((b) => !existingIds.has(b.id));
      return uniqueNew.length > 0 ? [...prev, ...uniqueNew] : prev;
    });
  }, []);

  const handleBookRemoved = useCallback((bookId: string) => {
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
  }, []);

  const handleAllBooksCleared = useCallback(() => {
    setBooks([]);
  }, []);

  return (
    <AudioControllerProvider onBookUpdated={handleBookUpdated}>
      <AppShell
        books={books}
        isLoadingBooks={isLoadingBooks}
        loadError={loadError}
        onRetryLoad={() => void loadLibrary()}
        onBooksAdded={handleBooksAdded}
        onBookReplaced={handleBookUpdated}
        onBookRemoved={handleBookRemoved}
        onAllBooksCleared={handleAllBooksCleared}
      />
    </AudioControllerProvider>
  );
}
