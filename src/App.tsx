import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AudiobookRecord } from './types/audiobook';
import {
  clearAllAudiobookRecords,
  deleteAudiobookRecord,
  getAllAudiobooks,
  reconcilePendingCheckpoint,
  updateAudiobookFields,
} from './storage/db';
import { clearAllAudioFiles, deleteAudioFile } from './storage/fileStorage';
import { AudioControllerProvider, useAudioController } from './playback/audioController';
import { OfflineBanner } from './components/OfflineBanner';
import { ImportView } from './components/ImportView';
import { LibraryView } from './components/LibraryView';
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

  if (isLoadingBooks) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-[#121212] px-6">
        <Loader2 className="w-7 h-7 text-[#B5A58A] animate-spin" aria-hidden="true" />
        <p className="text-sm text-[#A0A0A0]">Carregando biblioteca local...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#121212] px-5">
        <div className="w-full max-w-md rounded-2xl bg-[#1C1C1C] border border-[#2E2E2E] p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#CF6679] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h1 className="text-base font-semibold text-[#F0F0F0]">
                Erro ao recuperar dados locais
              </h1>
              <p className="mt-1.5 text-sm text-[#A0A0A0] leading-relaxed">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRetryLoad}
            className="w-full min-h-[44px] rounded-xl bg-[#B5A58A] text-[#121212] text-sm font-semibold hover:bg-[#C6B79E] transition"
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
      <div className="min-h-[100dvh] bg-[#121212]">
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
            if (summary.unsupportedCount > 0) {
              parts.push(`${summary.unsupportedCount} arquivo(s) não suportado(s) ignorado(s).`);
            }
            if (summary.duplicates.length > 0) {
              parts.push(`${summary.duplicates.length} duplicado(s) ignorado(s).`);
            }
            setImportNotice(parts.join(' '));
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#121212]">
      <OfflineBanner />

      {importNotice && screen === 'library' && (
        <div
          role="status"
          aria-live="polite"
          className="bg-[#1C1C1C] border-b border-[#2E2E2E] px-4 py-2.5 text-xs text-[#F0F0F0]"
        >
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <span>{importNotice}</span>
            <button
              type="button"
              onClick={() => setImportNotice(null)}
              className="text-[#B5A58A] font-medium shrink-0 px-2 py-1"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="bg-[#242424] border-b border-[#CF6679]/40 px-4 py-2.5 text-xs text-[#F0F0F0]"
        >
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-[#B5A58A] font-medium shrink-0 px-2 py-1"
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
    setBooks((prev) => [...prev, ...newBooks]);
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
