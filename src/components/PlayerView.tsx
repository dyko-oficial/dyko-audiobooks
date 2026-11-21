import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Headphones,
  Loader2,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { PLAYBACK_RATES, type AudiobookRecord } from '../types/audiobook';
import { useAudioController } from '../playback/audioController';
import {
  calculateProgressPercent,
  formatRate,
  formatTime,
  getStatusLabel,
} from '../utils/format';

interface PlayerViewProps {
  onBackToLibrary: () => void;
  onRequestRename: (book: AudiobookRecord) => void;
  onMarkCompleted: (book: AudiobookRecord) => void;
}

export const PlayerView: React.FC<PlayerViewProps> = ({
  onBackToLibrary,
  onRequestRename,
  onMarkCompleted,
}) => {
  const {
    activeBook,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    playbackRate,
    error,
    togglePlayPause,
    seekTo,
    seekBy,
    setPlaybackRate,
    restartCurrentBook,
    saveCurrentPosition,
    openAudiobook,
  } = useAudioController();

  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!activeBook) {
    return null;
  }

  const effectiveDuration = duration > 0 ? duration : activeBook.duration;
  const displayTime = isDragging ? dragValue : currentTime;
  const remaining = effectiveDuration > 0 ? Math.max(0, effectiveDuration - displayTime) : 0;
  const progressPercent =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, (displayTime / effectiveDuration) * 100))
      : 0;

  const handleBack = () => {
    void saveCurrentPosition();
    onBackToLibrary();
  };

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setDragValue(val);
    if (!isDragging) {
      seekTo(val);
    }
  };

  const handleRangeStart = () => {
    setDragValue(currentTime);
    setIsDragging(true);
  };

  const handleRangeCommit = () => {
    if (isDragging) {
      setIsDragging(false);
      seekTo(dragValue);
    }
  };

  const scrubberTrackStyle: React.CSSProperties = {
    background: `linear-gradient(to right, #B5A58A 0%, #B5A58A ${progressPercent}%, #2E2E2E ${progressPercent}%, #2E2E2E 100%)`,
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#121212]">
      {/* Compact Top Bar */}
      <header className="sticky top-0 z-20 bg-[#121212] border-b border-[#242424] pt-safe">
        <div className="max-w-2xl mx-auto h-14 px-3 sm:px-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 min-h-[44px] px-2 -ml-1 rounded-xl text-sm font-medium text-[#F0F0F0] hover:bg-[#1C1C1C] transition whitespace-nowrap shrink-0"
            aria-label="Voltar à biblioteca"
          >
            <ArrowLeft className="w-5 h-5 text-[#B5A58A]" aria-hidden="true" />
            <span>Biblioteca</span>
          </button>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="min-h-[44px] min-w-[44px] -mr-1.5 flex items-center justify-center rounded-xl text-[#A0A0A0] hover:text-[#F0F0F0] hover:bg-[#1C1C1C] transition"
              aria-label="Opções do audiolivro"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-56 rounded-xl bg-[#242424] border border-[#2E2E2E] py-1.5 shadow-lg z-40"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onRequestRename(activeBook);
                  }}
                  className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
                >
                  <Pencil className="w-4 h-4 text-[#A0A0A0] shrink-0" aria-hidden="true" />
                  <span>Renomear</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void restartCurrentBook();
                  }}
                  className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
                >
                  <RotateCcw className="w-4 h-4 text-[#A0A0A0] shrink-0" aria-hidden="true" />
                  <span>Ouvir do início</span>
                </button>

                {activeBook.status !== 'completed' && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onMarkCompleted(activeBook);
                    }}
                    className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
                  >
                    <Check className="w-4 h-4 text-[#A0A0A0] shrink-0" aria-hidden="true" />
                    <span>Marcar como concluído</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Player Surface */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-5 sm:px-8 py-6 sm:py-10 flex flex-col justify-between gap-8 pb-safe">
        {/* Book Identity & Calm Acoustic Focal Anchor */}
        <section className="flex-1 flex flex-col items-center justify-center text-center py-2">
          <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-3xl bg-[#1C1C1C] border border-[#2E2E2E] flex items-center justify-center mb-7">
            <Headphones
              className={`w-14 h-14 sm:w-16 sm:h-16 transition-colors duration-200 ${
                isPlaying ? 'text-[#B5A58A]' : 'text-[#A0A0A0]'
              }`}
              strokeWidth={1.4}
              aria-hidden="true"
            />
          </div>

          <h1 className="text-xl sm:text-2xl font-semibold text-[#F0F0F0] leading-snug max-w-lg text-balance">
            {activeBook.customName}
          </h1>

          <div className="mt-2.5 flex items-center justify-center gap-2 text-xs sm:text-sm text-[#A0A0A0]">
            <span>{isPlaying ? 'Reproduzindo' : getStatusLabel(activeBook.status)}</span>
            {effectiveDuration > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {calculateProgressPercent(displayTime, effectiveDuration, activeBook.status)}%
                  concluído
                </span>
              </>
            )}
          </div>

          {/* Completed state action */}
          {activeBook.status === 'completed' && !isPlaying && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => void restartCurrentBook()}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-[#242424] border border-[#2E2E2E] text-sm font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] active:scale-[0.98] transition"
              >
                <RotateCcw className="w-4 h-4 text-[#B5A58A]" aria-hidden="true" />
                <span>Ouvir novamente do início</span>
              </button>
            </div>
          )}

          {/* Error Recovery Panel */}
          {error && (
            <div
              role="alert"
              className="mt-6 w-full max-w-md rounded-2xl bg-[#1C1C1C] border border-[#CF6679]/40 p-4 text-left space-y-3"
            >
              <div className="flex items-start gap-2.5 text-sm text-[#F0F0F0]">
                <AlertCircle className="w-5 h-5 text-[#CF6679] shrink-0 mt-0.5" aria-hidden="true" />
                <p className="leading-relaxed">{error}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openAudiobook(activeBook, { autoPlay: true })}
                  className="min-h-[44px] px-4 rounded-xl bg-[#242424] border border-[#2E2E2E] text-xs font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
                >
                  Tentar novamente
                </button>
                <button
                  type="button"
                  onClick={handleBack}
                  className="min-h-[44px] px-4 rounded-xl text-xs font-medium text-[#A0A0A0] hover:text-[#F0F0F0] transition"
                >
                  Voltar à biblioteca
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Bottom Thumb-Zone Controls */}
        <section className="space-y-6 pb-2" aria-label="Controles de reprodução">
          {/* Interactive Timeline Scrubber */}
          <div className="space-y-1">
            <div className="relative flex items-center">
              <div
                className="pointer-events-none absolute left-0 right-0 h-[5px] rounded-full"
                style={scrubberTrackStyle}
                aria-hidden="true"
              />
              <input
                type="range"
                min={0}
                max={effectiveDuration > 0 ? effectiveDuration : 100}
                step={1}
                value={effectiveDuration > 0 ? Math.min(displayTime, effectiveDuration) : 0}
                disabled={effectiveDuration <= 0}
                onPointerDown={handleRangeStart}
                onPointerUp={handleRangeCommit}
                onPointerCancel={handleRangeCommit}
                onTouchEnd={handleRangeCommit}
                onKeyUp={handleRangeCommit}
                onChange={handleRangeChange}
                aria-label="Posição de reprodução"
                aria-valuemin={0}
                aria-valuemax={Math.floor(effectiveDuration)}
                aria-valuenow={Math.floor(displayTime)}
                aria-valuetext={`${formatTime(displayTime)} de ${formatTime(effectiveDuration)}`}
                className="audio-scrubber relative z-10 disabled:opacity-40"
              />
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-[#A0A0A0] tabular-nums">
              <span>{formatTime(displayTime)}</span>
              <span>
                {effectiveDuration > 0
                  ? `-${formatTime(remaining)} · ${formatTime(effectiveDuration)}`
                  : '--:--'}
              </span>
            </div>
          </div>

          {/* Primary Transport Buttons: -15s | Play/Pause | +30s */}
          <div className="flex items-center justify-center gap-7 sm:gap-10">
            <button
              type="button"
              onClick={() => seekBy(-15)}
              disabled={effectiveDuration <= 0}
              className="w-14 h-14 rounded-full bg-[#1C1C1C] border border-[#2E2E2E] flex flex-col items-center justify-center text-[#F0F0F0] hover:bg-[#242424] active:scale-95 disabled:opacity-40 transition"
              aria-label="Retroceder 15 segundos"
            >
              <RotateCcw className="w-5 h-5 text-[#A0A0A0]" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-[11px] font-mono tabular-nums leading-none mt-0.5 text-[#F0F0F0]">
                15
              </span>
            </button>

            <button
              type="button"
              onClick={() => void togglePlayPause()}
              disabled={isLoading}
              className="w-[72px] h-[72px] rounded-full bg-[#B5A58A] text-[#121212] flex items-center justify-center hover:bg-[#C6B79E] active:scale-95 disabled:opacity-60 transition"
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isLoading ? (
                <Loader2 className="w-8 h-8 animate-spin" aria-hidden="true" />
              ) : isPlaying ? (
                <Pause className="w-8 h-8 fill-current" aria-hidden="true" />
              ) : (
                <Play className="w-8 h-8 fill-current ml-1" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => seekBy(30)}
              disabled={effectiveDuration <= 0}
              className="w-14 h-14 rounded-full bg-[#1C1C1C] border border-[#2E2E2E] flex flex-col items-center justify-center text-[#F0F0F0] hover:bg-[#242424] active:scale-95 disabled:opacity-40 transition"
              aria-label="Avançar 30 segundos"
            >
              <RotateCw className="w-5 h-5 text-[#A0A0A0]" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-[11px] font-mono tabular-nums leading-none mt-0.5 text-[#F0F0F0]">
                30
              </span>
            </button>
          </div>

          {/* Playback Speed Selector */}
          <div className="pt-1">
            <p className="text-center text-xs text-[#A0A0A0] mb-2.5">Velocidade de reprodução</p>
            <div
              role="radiogroup"
              aria-label="Velocidade de reprodução"
              className="grid grid-cols-6 gap-1.5 p-1 rounded-xl bg-[#1C1C1C] border border-[#2E2E2E]"
            >
              {PLAYBACK_RATES.map((rate) => {
                const isSelected = playbackRate === rate;
                return (
                  <button
                    key={rate}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setPlaybackRate(rate)}
                    className={`min-h-[44px] rounded-lg font-mono text-xs sm:text-sm tabular-nums transition whitespace-nowrap ${
                      isSelected
                        ? 'bg-[#B5A58A] text-[#121212] font-semibold'
                        : 'text-[#A0A0A0] hover:text-[#F0F0F0] hover:bg-[#242424]'
                    }`}
                  >
                    {formatRate(rate)}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
