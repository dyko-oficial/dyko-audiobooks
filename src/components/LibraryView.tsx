import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  BookOpen,
  Check,
  Headphones,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { AudiobookRecord, FilterOption, SortOption } from '../types/audiobook';
import { useAudioController } from '../playback/audioController';
import {
  calculateProgressPercent,
  formatDurationHuman,
  formatTime,
  getStatusLabel,
} from '../utils/format';
import { PWAInstallButton } from './PWAInstallButton';

interface LibraryViewProps {
  books: AudiobookRecord[];
  onSelectBook: (book: AudiobookRecord) => void;
  onOpenImport: () => void;
  onRequestRename: (book: AudiobookRecord) => void;
  onMarkCompleted: (book: AudiobookRecord) => void;
  onRestartBook: (book: AudiobookRecord) => void;
  onRequestDeleteBook: (book: AudiobookRecord) => void;
  onRequestDeleteAll: () => void;
}

const FILTER_TABS: Array<{ value: FilterOption; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'not_started', label: 'Não iniciados' },
  { value: 'completed', label: 'Concluídos' },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'lastPlayedAt', label: 'Última reprodução' },
  { value: 'importedAt', label: 'Data de adição' },
  { value: 'name', label: 'Nome' },
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
}) => {
  const { activeBook, isPlaying } = useAudioController();
  const [filter, setFilter] = useState<FilterOption>('all');
  const [sortBy, setSortBy] = useState<SortOption>('lastPlayedAt');
  const [openMenuBookId, setOpenMenuBookId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

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

  const filteredAndSortedBooks = useMemo(() => {
    const filtered = filter === 'all' ? books : books.filter((b) => b.status === filter);
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return a.customName.localeCompare(b.customName, 'pt-BR', { sensitivity: 'base' });
      }
      if (sortBy === 'importedAt') {
        return b.importedAt - a.importedAt;
      }
      // lastPlayedAt: most recently played first, fallback to importedAt
      const aPlayed = a.lastPlayedAt ?? 0;
      const bPlayed = b.lastPlayedAt ?? 0;
      if (aPlayed !== bPlayed) return bPlayed - aPlayed;
      return b.importedAt - a.importedAt;
    });
  }, [books, filter, sortBy]);

  return (
    <div ref={menuContainerRef} className={activeBook ? 'pb-24' : 'pb-10'}>
      {/* Sticky Top App Bar (compact 56px) */}
      <header className="sticky top-0 z-20 bg-[#121212]/95 backdrop-blur-sm border-b border-[#2E2E2E] pt-safe">
        <div className="max-w-4xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight text-[#F0F0F0] whitespace-nowrap shrink-0">
            Dyko Audiobooks
          </h1>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton variant="header" />

            <button
              type="button"
              onClick={onOpenImport}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 rounded-xl bg-[#B5A58A] text-[#121212] text-xs sm:text-sm font-semibold hover:bg-[#C6B79E] active:scale-[0.98] transition whitespace-nowrap shrink-0"
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
                className="min-h-[44px] min-w-[44px] -mr-1.5 flex items-center justify-center rounded-xl text-[#A0A0A0] hover:text-[#F0F0F0] hover:bg-[#1C1C1C] transition"
                aria-label="Mais opções da biblioteca"
                aria-expanded={headerMenuOpen}
                aria-haspopup="menu"
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {headerMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1.5 w-60 rounded-xl bg-[#242424] border border-[#2E2E2E] py-1.5 shadow-lg z-40"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      onRequestDeleteAll();
                    }}
                    className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#CF6679] hover:bg-[#2C2C2C] transition"
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

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-5">
        {/* Filter Tabs & Sort Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          {/* Segmented state filter controls */}
          <div
            role="tablist"
            aria-label="Filtrar audiolivros por estado"
            className="flex items-center gap-1 p-1 rounded-xl bg-[#1C1C1C] border border-[#2E2E2E] overflow-x-auto"
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
                  className={`min-h-[40px] px-3 rounded-lg text-xs sm:text-sm font-medium transition whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-[#242424] text-[#F0F0F0]'
                      : 'text-[#A0A0A0] hover:text-[#F0F0F0]'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-xs tabular-nums ${
                      isActive ? 'text-[#B5A58A]' : 'text-[#A0A0A0]/70'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sort selector */}
          <div className="flex items-center justify-end sm:justify-start gap-2 shrink-0">
            <ArrowUpDown className="w-4 h-4 text-[#A0A0A0] shrink-0" aria-hidden="true" />
            <label htmlFor="library-sort-select" className="sr-only">
              Ordenar audiolivros por
            </label>
            <select
              id="library-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="min-h-[44px] pl-3 pr-8 rounded-xl bg-[#1C1C1C] border border-[#2E2E2E] text-xs sm:text-sm text-[#F0F0F0] focus:border-[#B5A58A] focus:outline-none"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#1C1C1C] text-[#F0F0F0]">
                  Ordenar: {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Vertical List of Audiobooks */}
        {filteredAndSortedBooks.length === 0 ? (
          <div className="rounded-2xl bg-[#1C1C1C] border border-[#2E2E2E] p-8 text-center">
            <p className="text-sm text-[#A0A0A0]">
              Nenhum audiolivro encontrado em{' '}
              <span className="text-[#F0F0F0] font-medium">
                {FILTER_TABS.find((t) => t.value === filter)?.label.toLowerCase()}
              </span>
              .
            </p>
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="mt-4 min-h-[44px] px-4 rounded-xl bg-[#242424] border border-[#2E2E2E] text-sm font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
              >
                Ver todos os audiolivros
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[#242424] rounded-2xl bg-[#1C1C1C] border border-[#2E2E2E]">
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
                    isCurrent ? 'bg-[#242424]/70' : 'hover:bg-[#242424]/40'
                  }`}
                >
                  <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5 sm:py-4">
                    {/* Primary tap target to open player */}
                    <button
                      type="button"
                      onClick={() => onSelectBook(book)}
                      className="flex-1 min-w-0 flex items-start gap-3.5 text-left rounded-lg py-0.5 focus-visible:outline-[#B5A58A]"
                    >
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${
                          isCurrent
                            ? 'bg-[#B5A58A]/15 border-[#B5A58A]/40 text-[#B5A58A]'
                            : 'bg-[#242424] border-[#2E2E2E] text-[#A0A0A0]'
                        }`}
                      >
                        {isCurrent && isPlaying ? (
                          <Headphones className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
                        ) : (
                          <BookOpen className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h2
                          className={`text-sm sm:text-base font-medium leading-snug line-clamp-2 ${
                            isCurrent ? 'text-[#B5A58A]' : 'text-[#F0F0F0]'
                          }`}
                        >
                          {book.customName}
                        </h2>

                        {/* Clean unboxed metadata row (zero pills) */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#A0A0A0]">
                          <span
                            className={
                              book.status === 'in_progress'
                                ? 'text-[#B5A58A]'
                                : book.status === 'completed'
                                  ? 'text-[#F0F0F0]/80'
                                  : 'text-[#A0A0A0]'
                            }
                          >
                            {isCurrent && isPlaying ? 'Reproduzindo' : getStatusLabel(book.status)}
                          </span>

                          {book.duration > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                {formatDurationHuman(book.duration)}
                              </span>
                            </>
                          )}

                          {book.status === 'in_progress' && book.currentTime > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatTime(book.currentTime)}
                                {book.duration > 0 ? ` (${progressPct}%)` : ''}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Minimal inline progress line for in-progress books */}
                        {book.status === 'in_progress' && book.duration > 0 && (
                          <div className="mt-2.5 w-full max-w-xs h-1 rounded-full bg-[#2E2E2E] overflow-hidden">
                            <div
                              className="h-full bg-[#B5A58A]"
                              style={{ width: `${Math.max(2, progressPct)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Item action menu button */}
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          setOpenMenuBookId(isMenuOpen ? null : book.id);
                        }}
                        className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#A0A0A0] hover:text-[#F0F0F0] hover:bg-[#242424] transition"
                        aria-label={`Opções para ${book.customName}`}
                        aria-expanded={isMenuOpen}
                        aria-haspopup="menu"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>

                      {isMenuOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 mt-1 w-56 rounded-xl bg-[#242424] border border-[#2E2E2E] py-1.5 shadow-lg z-40"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuBookId(null);
                              onRequestRename(book);
                            }}
                            className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
                          >
                            <Pencil className="w-4 h-4 text-[#A0A0A0] shrink-0" aria-hidden="true" />
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
                              className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
                            >
                              <Check className="w-4 h-4 text-[#A0A0A0] shrink-0" aria-hidden="true" />
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
                              className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
                            >
                              <RotateCcw
                                className="w-4 h-4 text-[#A0A0A0] shrink-0"
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
                              className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
                            >
                              <RotateCcw
                                className="w-4 h-4 text-[#A0A0A0] shrink-0"
                                aria-hidden="true"
                              />
                              <span>Reiniciar do início</span>
                            </button>
                          )}

                          <div className="my-1 border-t border-[#2E2E2E]" />

                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuBookId(null);
                              onRequestDeleteBook(book);
                            }}
                            className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#CF6679] hover:bg-[#2C2C2C] transition"
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
