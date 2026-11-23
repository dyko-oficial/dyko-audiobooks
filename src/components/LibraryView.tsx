import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  AudioLines,
  Check,
  Loader2,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { AudiobookRecord, FilterOption, SortOption } from '../types/audiobook';
import { useAudioController } from '../playback/audioController';
import { needsMp4Optimization } from '../import/importManager';
import {
  calculateProgressPercent,
  formatDurationHuman,
  formatTime,
  getStatusLabel,
} from '../utils/format';
import { PWAInstallButton } from './PWAInstallButton';

export interface OptimizationProgressState {
  currentIndex: number;
  total: number;
  currentTitle: string;
  percent: number;
}

interface LibraryViewProps {
  books: AudiobookRecord[];
  onSelectBook: (book: AudiobookRecord) => void;
  onOpenImport: () => void;
  onRequestRename: (book: AudiobookRecord) => void;
  onMarkCompleted: (book: AudiobookRecord) => void;
  onRestartBook: (book: AudiobookRecord) => void;
  onRequestDeleteBook: (book: AudiobookRecord) => void;
  onRequestDeleteAll: () => void;
  onOptimizeBooks: (targets: AudiobookRecord[]) => void;
  optimizationProgress: OptimizationProgressState | null;
}

const FILTER_TABS: Array<{ value: FilterOption; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'not_started', label: 'Não iniciados' },
  { value: 'completed', label: 'Concluídos' },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'lastPlayedAt', label: 'Recentes' },
  { value: 'importedAt', label: 'Adicionados' },
  { value: 'name', label: 'Título' },
];

export const LibraryView: React.FC<LibraryViewProps> = ({
  books,
  onSelectBook,
  onOpenImport,
  onRequestRename,
  onMarkCompleted,
  onRestartBook,
  onRequestDeleteBook,
  onRequestDeleteAll,
  onOptimizeBooks,
  optimizationProgress,
}) => {
  const { activeBook, isPlaying, togglePlayPause } = useAudioController();
  const [filter, setFilter] = useState<FilterOption>('all');
  const [sortBy, setSortBy] = useState<SortOption>('lastPlayedAt');
  const [openMenuBookId, setOpenMenuBookId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const isOptimizing = Boolean(optimizationProgress);

  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuBookId(null);
        setHeaderMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuBookId(null);
        setHeaderMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const counts = useMemo(() => {
    let notStarted = 0;
    let inProgress = 0;
    let completed = 0;
    for (const b of books) {
      if (b.status === 'in_progress') inProgress++;
      else if (b.status === 'completed') completed++;
      else notStarted++;
    }
    return {
      all: books.length,
      in_progress: inProgress,
      not_started: notStarted,
      completed,
    };
  }, [books]);

  const unoptimizedMp4Books = useMemo(
    () => books.filter((b) => needsMp4Optimization(b)),
    [books]
  );

  // Featured "Continue listening" spotlight: active book or most recently played in-progress book
  const resumeBook = useMemo(() => {
    if (activeBook) {
      return books.find((b) => b.id === activeBook.id) ?? activeBook;
    }
    const inProgressBooks = books.filter((b) => b.status === 'in_progress');
    if (inProgressBooks.length === 0) return null;
    return [...inProgressBooks].sort(
      (a, b) => (b.lastPlayedAt ?? b.importedAt) - (a.lastPlayedAt ?? a.importedAt)
    )[0];
  }, [activeBook, books]);

  const filteredAndSortedBooks = useMemo(() => {
    const filtered = filter === 'all' ? books : books.filter((b) => b.status === filter);
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return a.customName.localeCompare(b.customName, 'pt-BR', { sensitivity: 'base' });
      }
      if (sortBy === 'importedAt') {
        return b.importedAt - a.importedAt;
      }
      const aPlayed = a.lastPlayedAt ?? 0;
      const bPlayed = b.lastPlayedAt ?? 0;
      if (aPlayed !== bPlayed) return bPlayed - aPlayed;
      return b.importedAt - a.importedAt;
    });
  }, [books, filter, sortBy]);

  const resumePercent = resumeBook
    ? calculateProgressPercent(resumeBook.currentTime, resumeBook.duration, resumeBook.status)
    : 0;
  const resumeRemaining =
    resumeBook && resumeBook.duration > 0
      ? Math.max(0, resumeBook.duration - resumeBook.currentTime)
      : 0;
  const isResumeBookActive = Boolean(resumeBook && activeBook?.id === resumeBook.id);

  return (
    <div ref={menuContainerRef} className={activeBook ? 'pb-24' : 'pb-12'}>
      {/* Sticky 56px Top Bar: strictly 2 sides, zero crowding on 360px phones */}
      <header className="sticky top-0 z-20 bg-[#11161C]/95 backdrop-blur-sm border-b border-[#2A3642]/70 pt-safe">
        <div className="max-w-5xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
          <h1 className="font-display text-lg sm:text-xl font-medium tracking-tight text-[#EDE9E0] whitespace-nowrap shrink-0">
            Dyko Audiobooks
          </h1>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenImport}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 rounded-xl bg-[#E0A458] text-[#11161C] text-xs sm:text-sm font-semibold hover:bg-[#ECB56F] active:scale-[0.98] transition whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Importar</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setHeaderMenuOpen((prev) => !prev);
                  setOpenMenuBookId(null);
                }}
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#96A2AE] hover:text-[#EDE9E0] hover:bg-[#182028] transition-colors"
                aria-label="Mais opções da biblioteca"
                aria-expanded={headerMenuOpen}
                aria-haspopup="menu"
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {headerMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1.5 w-60 rounded-xl bg-[#212B36] border border-[#2A3642] py-1.5 shadow-xl z-40"
                >
                  <PWAInstallButton
                    variant="menu"
                    onAction={() => setHeaderMenuOpen(false)}
                  />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      onRequestDeleteAll();
                    }}
                    className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#E06C75] hover:bg-[#283442] transition-colors"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Remover todos os audiolivros</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Shelf Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7">
        {/* Featured "Continue Listening" Quiet Surface (Single Elevated Focal Point) */}
        {resumeBook && (
          <section
            aria-label="Continuar ouvindo"
            className="mb-6 rounded-2xl bg-[#182028] border border-[#2A3642] p-4 sm:p-5"
          >
            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => onSelectBook(resumeBook)}
                className="flex-1 min-w-0 text-left group focus-visible:outline-[#E0A458] rounded-lg"
              >
                <p className="text-xs text-[#E0A458] font-medium">
                  {isResumeBookActive && isPlaying ? 'Ouvindo agora' : 'Continuar ouvindo'}
                </p>
                <h2 className="mt-1 font-display text-lg sm:text-xl font-medium text-[#EDE9E0] leading-snug line-clamp-2 group-hover:text-[#E0A458] transition-colors">
                  {resumeBook.customName}
                </h2>
                <div className="mt-2.5 flex items-center justify-between gap-3 text-xs text-[#96A2AE] tabular-nums">
                  <span>{resumePercent}% concluído</span>
                  {resumeRemaining > 0 && <span>Restam {formatDurationHuman(resumeRemaining)}</span>}
                </div>
                <div className="mt-2 w-full h-1 rounded-full bg-[#2A3642] overflow-hidden">
                  <div
                    className="h-full bg-[#E0A458] transition-all duration-300"
                    style={{ width: `${Math.max(2, resumePercent)}%` }}
                  />
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isResumeBookActive) {
                    void togglePlayPause();
                  } else {
                    onSelectBook(resumeBook);
                  }
                }}
                className="w-12 h-12 sm:w-13 sm:h-13 rounded-full bg-[#E0A458] text-[#11161C] flex items-center justify-center hover:bg-[#ECB56F] active:scale-95 transition shrink-0"
                aria-label={
                  isResumeBookActive && isPlaying
                    ? `Pausar ${resumeBook.customName}`
                    : `Continuar ${resumeBook.customName}`
                }
              >
                {isResumeBookActive && isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </section>
        )}

        {/* Pending MP4 Background Optimization Notice */}
        {(unoptimizedMp4Books.length > 0 || optimizationProgress) && (
          <div className="mb-6 rounded-xl bg-[#182028] border border-[#2A3642] p-4">
            {optimizationProgress ? (
              <div className="space-y-2.5" role="status" aria-live="polite">
                <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                  <span className="flex items-center gap-2 font-medium text-[#EDE9E0] min-w-0">
                    <Loader2 className="w-4 h-4 text-[#E0A458] animate-spin shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      Otimizando {optimizationProgress.currentIndex} de {optimizationProgress.total}:{' '}
                      {optimizationProgress.currentTitle}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-[#E0A458] tabular-nums shrink-0">
                    {optimizationProgress.percent}%
                  </span>
                </div>
                <div className="w-full h-1 rounded-full bg-[#2A3642] overflow-hidden">
                  <div
                    className="h-full bg-[#E0A458] transition-all duration-150"
                    style={{ width: `${Math.max(4, optimizationProgress.percent)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs sm:text-sm text-[#96A2AE] leading-relaxed">
                  {unoptimizedMp4Books.length === 1
                    ? '1 audiolivro MP4 pode ter o vídeo removido para tocar com a tela bloqueada, mantendo seu progresso.'
                    : `${unoptimizedMp4Books.length} audiolivros MP4 podem ter o vídeo removido para tocar com a tela bloqueada, mantendo o progresso.`}
                </p>
                <button
                  type="button"
                  onClick={() => onOptimizeBooks(unoptimizedMp4Books)}
                  className="min-h-[44px] px-4 rounded-xl bg-[#212B36] border border-[#E0A458]/40 text-xs sm:text-sm font-medium text-[#EDE9E0] hover:bg-[#283442] active:scale-[0.98] transition whitespace-nowrap shrink-0"
                >
                  Otimizar agora
                </button>
              </div>
            )}
          </div>
        )}

        {/* Flush Editorial Filter Rail & Sort Row */}
        <div className="border-b border-[#2A3642] mb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div
              role="tablist"
              aria-label="Filtrar audiolivros por estado"
              className="flex items-center gap-5 overflow-x-auto no-scrollbar -mb-px"
            >
              {FILTER_TABS.map((tab) => {
                const isActive = filter === tab.value;
                const count = counts[tab.value];
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setFilter(tab.value)}
                    className={`min-h-[44px] pb-2.5 pt-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 border-b-2 ${
                      isActive
                        ? 'border-[#E0A458] text-[#EDE9E0]'
                        : 'border-transparent text-[#96A2AE] hover:text-[#EDE9E0]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`text-xs tabular-nums ${
                        isActive ? 'text-[#E0A458]' : 'text-[#96A2AE]/70'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2 pb-2 sm:pb-1.5 shrink-0">
              <span className="text-xs text-[#96A2AE] sm:hidden tabular-nums">
                {filteredAndSortedBooks.length}{' '}
                {filteredAndSortedBooks.length === 1 ? 'livro' : 'livros'}
              </span>
              <div className="inline-flex items-center gap-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-[#96A2AE] shrink-0" aria-hidden="true" />
                <label htmlFor="library-sort-select" className="sr-only">
                  Ordenar audiolivros por
                </label>
                <select
                  id="library-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="min-h-[36px] pl-1 pr-6 bg-transparent text-xs sm:text-sm text-[#EDE9E0] focus:outline-none cursor-pointer"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-[#182028] text-[#EDE9E0]">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Open Editorial Audiobook List (Directly on Bookcloth Canvas, Zero Card-in-Card Boxes) */}
        {filteredAndSortedBooks.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-[#96A2AE]">
              Nenhum audiolivro em{' '}
              <span className="text-[#EDE9E0] font-medium">
                {FILTER_TABS.find((t) => t.value === filter)?.label.toLowerCase()}
              </span>
              .
            </p>
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="mt-4 min-h-[44px] px-4 rounded-xl bg-[#182028] border border-[#2A3642] text-sm font-medium text-[#EDE9E0] hover:bg-[#212B36] transition-colors"
              >
                Mostrar todos os audiolivros
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[#2A3642]/70">
            {filteredAndSortedBooks.map((book) => {
              const isCurrent = activeBook?.id === book.id;
              const progressPct = calculateProgressPercent(
                book.currentTime,
                book.duration,
                book.status
              );
              const isMenuOpen = openMenuBookId === book.id;

              return (
                <li
                  key={book.id}
                  className={`relative transition-colors ${
                    isCurrent ? 'bg-[#182028]/60 -mx-2 px-2 rounded-xl' : ''
                  }`}
                >
                  <div className="flex items-start gap-3 py-4">
                    {/* Primary tap target to open player */}
                    <button
                      type="button"
                      onClick={() => onSelectBook(book)}
                      className="flex-1 min-w-0 flex items-stretch gap-3.5 text-left rounded-lg focus-visible:outline-[#E0A458]"
                    >
                      {/* Book-Spine Vertical Reading Ribbon */}
                      <div
                        className="w-[3px] self-stretch my-1 rounded-full bg-[#2A3642] overflow-hidden flex flex-col justify-end shrink-0"
                        aria-hidden="true"
                      >
                        <div
                          className={`w-full rounded-full transition-all duration-300 ${
                            book.status === 'completed'
                              ? 'bg-[#E0A458]/70'
                              : isCurrent || book.status === 'in_progress'
                                ? 'bg-[#E0A458]'
                                : 'bg-transparent'
                          }`}
                          style={{
                            height:
                              book.status === 'completed'
                                ? '100%'
                                : book.status === 'in_progress' || isCurrent
                                  ? `${Math.max(14, progressPct)}%`
                                  : '0%',
                          }}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3
                          className={`font-display text-[17px] sm:text-lg font-medium leading-snug line-clamp-2 ${
                            isCurrent ? 'text-[#E0A458]' : 'text-[#EDE9E0]'
                          }`}
                        >
                          {book.customName}
                        </h3>

                        {/* Clean two-slot metadata row (Zero middle dots) */}
                        <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs text-[#96A2AE]">
                          <span
                            className={
                              isCurrent && isPlaying
                                ? 'text-[#E0A458] font-medium'
                                : book.status === 'in_progress'
                                  ? 'text-[#EDE9E0]/85'
                                  : 'text-[#96A2AE]'
                            }
                          >
                            {isCurrent && isPlaying
                              ? 'Ouvindo agora'
                              : book.status === 'in_progress' && book.duration > 0
                                ? `${progressPct}% ouvido`
                                : getStatusLabel(book.status)}
                          </span>

                          <span className="tabular-nums shrink-0 text-right">
                            {book.status === 'in_progress' && book.currentTime > 0
                              ? formatTime(book.currentTime)
                              : book.duration > 0
                                ? formatDurationHuman(book.duration)
                                : ''}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Item action menu button */}
                    <div className="relative shrink-0 -mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          setOpenMenuBookId(isMenuOpen ? null : book.id);
                        }}
                        className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#96A2AE] hover:text-[#EDE9E0] hover:bg-[#182028] transition-colors"
                        aria-label={`Opções para ${book.customName}`}
                        aria-expanded={isMenuOpen}
                        aria-haspopup="menu"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>

                      {isMenuOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 mt-1 w-60 rounded-xl bg-[#212B36] border border-[#2A3642] py-1.5 shadow-xl z-40"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuBookId(null);
                              onRequestRename(book);
                            }}
                            className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
                          >
                            <Pencil className="w-4 h-4 text-[#96A2AE] shrink-0" aria-hidden="true" />
                            <span>Renomear</span>
                          </button>

                          {book.status !== 'completed' ? (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuBookId(null);
                                onMarkCompleted(book);
                              }}
                              className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
                            >
                              <Check className="w-4 h-4 text-[#96A2AE] shrink-0" aria-hidden="true" />
                              <span>Marcar como concluído</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuBookId(null);
                                onRestartBook(book);
                              }}
                              className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
                            >
                              <RotateCcw
                                className="w-4 h-4 text-[#96A2AE] shrink-0"
                                aria-hidden="true"
                              />
                              <span>Ouvir do início</span>
                            </button>
                          )}

                          {book.status === 'in_progress' && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuBookId(null);
                                onRestartBook(book);
                              }}
                              className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
                            >
                              <RotateCcw
                                className="w-4 h-4 text-[#96A2AE] shrink-0"
                                aria-hidden="true"
                              />
                              <span>Reiniciar do início</span>
                            </button>
                          )}

                          {needsMp4Optimization(book) && (
                            <button
                              type="button"
                              role="menuitem"
                              disabled={isOptimizing}
                              onClick={() => {
                                setOpenMenuBookId(null);
                                onOptimizeBooks([book]);
                              }}
                              className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#E0A458] hover:bg-[#283442] disabled:opacity-50 transition-colors"
                            >
                              <AudioLines className="w-4 h-4 shrink-0" aria-hidden="true" />
                              <span>Otimizar para segundo plano</span>
                            </button>
                          )}

                          <div className="my-1 border-t border-[#2A3642]" />

                          <button
                            type="button"
                            role="menuitem"
                            disabled={isOptimizing}
                            onClick={() => {
                              setOpenMenuBookId(null);
                              onRequestDeleteBook(book);
                            }}
                            className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#E06C75] hover:bg-[#283442] disabled:opacity-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>Remover</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
};
