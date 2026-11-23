import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
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

function getBookMonogram(title: string): string {
  const words = title
    .trim()
    .split(/[\s\-–—_.:/]+/)
    .filter((w) => /[A-Za-zÀ-ÿ0-9]/.test(w));
  if (words.length === 0) return 'DA';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

const DIAL_TICKS = Array.from({ length: 60 }, (_, idx) => {
  const angleDeg = idx * 6 - 90;
  const rad = (angleDeg * Math.PI) / 180;
  const isMajor = idx % 5 === 0;
  const rOuter = 104;
  const rInner = isMajor ? 95 : 99;
  return {
    key: idx,
    isMajor,
    x1: 120 + rInner * Math.cos(rad),
    y1: 120 + rInner * Math.sin(rad),
    x2: 120 + rOuter * Math.cos(rad),
    y2: 120 + rOuter * Math.sin(rad),
  };
});

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

  const monogram = useMemo(
    () => (activeBook ? getBookMonogram(activeBook.customName) : ''),
    [activeBook]
  );

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
  const roundedPercent = calculateProgressPercent(displayTime, effectiveDuration, activeBook.status);

  // SVG progress arc math (r = 84)
  const arcRadius = 84;
  const arcCircumference = 2 * Math.PI * arcRadius;
  const arcDashOffset = arcCircumference * (1 - progressPercent / 100);

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
    background: `linear-gradient(to right, #E0A458 0%, #E0A458 ${progressPercent}%, #2A3642 ${progressPercent}%, #2A3642 100%)`,
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#11161C]">
      {/* Compact 56px Top Bar */}
      <header className="sticky top-0 z-20 bg-[#11161C]/95 backdrop-blur-sm border-b border-[#2A3642]/70 pt-safe">
        <div className="max-w-5xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 min-h-[44px] px-2 -ml-2 rounded-xl text-sm font-medium text-[#EDE9E0] hover:bg-[#182028] transition-colors whitespace-nowrap shrink-0"
            aria-label="Voltar à biblioteca"
          >
            <ArrowLeft className="w-4 h-4 text-[#E0A458]" aria-hidden="true" />
            <span>Biblioteca</span>
          </button>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#96A2AE] hover:text-[#EDE9E0] hover:bg-[#182028] transition-colors"
              aria-label="Opções do audiolivro"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-56 rounded-xl bg-[#212B36] border border-[#2A3642] py-1.5 shadow-xl z-40"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onRequestRename(activeBook);
                  }}
                  className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
                >
                  <Pencil className="w-4 h-4 text-[#96A2AE] shrink-0" aria-hidden="true" />
                  <span>Renomear</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void restartCurrentBook();
                  }}
                  className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
                >
                  <RotateCcw className="w-4 h-4 text-[#96A2AE] shrink-0" aria-hidden="true" />
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
                    className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
                  >
                    <Check className="w-4 h-4 text-[#96A2AE] shrink-0" aria-hidden="true" />
                    <span>Marcar como concluído</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Listening Room Surface */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 py-6 sm:py-10 flex flex-col lg:grid lg:grid-cols-12 lg:items-center lg:gap-12 justify-between gap-8 pb-safe">
        {/* Focal Anchor: Tactile Acoustic Progress Dial & Book Title */}
        <section className="flex-1 lg:col-span-6 flex flex-col items-center justify-center text-center py-1">
          <div className="relative w-52 h-52 sm:w-60 sm:h-60 mb-7 select-none">
            <svg
              viewBox="0 0 240 240"
              className="w-full h-full"
              role="img"
              aria-label={`Progresso de leitura: ${roundedPercent}%`}
            >
              {/* Subtle base plate */}
              <circle
                cx="120"
                cy="120"
                r="112"
                fill="#182028"
                stroke="#2A3642"
                strokeWidth="1"
              />

              {/* 60 engraved acoustic dial ticks */}
              {DIAL_TICKS.map((tick) => (
                <line
                  key={tick.key}
                  x1={tick.x1}
                  y1={tick.y1}
                  x2={tick.x2}
                  y2={tick.y2}
                  stroke={tick.isMajor ? '#435365' : '#2A3642'}
                  strokeWidth={tick.isMajor ? 1.4 : 1}
                  strokeLinecap="round"
                />
              ))}

              {/* Background progress track */}
              <circle
                cx="120"
                cy="120"
                r={arcRadius}
                fill="none"
                stroke="#212B36"
                strokeWidth="4"
              />

              {/* Active brass bookmark progress arc */}
              <circle
                cx="120"
                cy="120"
                r={arcRadius}
                fill="none"
                stroke="#E0A458"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={arcCircumference}
                strokeDashoffset={arcDashOffset}
                transform="rotate(-90 120 120)"
                className="transition-[stroke-dashoffset] duration-200"
              />

              {/* Inner quiet turntable ring with calm orbital cue only while playing */}
              <circle
                cx="120"
                cy="120"
                r="66"
                fill="none"
                stroke="#2A3642"
                strokeWidth="1"
              />

              {isPlaying && (
                <g className="origin-center animate-dial-orbit" style={{ transformOrigin: '120px 120px' }}>
                  <circle cx="120" cy="54" r="3" fill="#E0A458" />
                </g>
              )}
            </svg>

            {/* Centered Book Monogram & Percentage */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span
                className={`font-display text-4xl sm:text-[42px] font-medium tracking-tight leading-none transition-colors duration-200 ${
                  isPlaying ? 'text-[#EDE9E0]' : 'text-[#EDE9E0]/85'
                }`}
              >
                {monogram}
              </span>
              {effectiveDuration > 0 && (
                <span className="mt-2 text-xs font-medium text-[#E0A458] tabular-nums">
                  {roundedPercent}%
                </span>
              )}
            </div>
          </div>

          <h1 className="font-display text-2xl sm:text-[28px] font-medium text-[#EDE9E0] leading-snug max-w-md text-balance">
            {activeBook.customName}
          </h1>

          <p className="mt-2 text-sm text-[#96A2AE]">
            {isPlaying ? 'Ouvindo agora' : getStatusLabel(activeBook.status)}
          </p>

          {/* Completed state direct action */}
          {activeBook.status === 'completed' && !isPlaying && (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => void restartCurrentBook()}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-[#182028] border border-[#2A3642] text-sm font-medium text-[#EDE9E0] hover:bg-[#212B36] active:scale-[0.98] transition"
              >
                <RotateCcw className="w-4 h-4 text-[#E0A458]" aria-hidden="true" />
                <span>Ouvir novamente do início</span>
              </button>
            </div>
          )}

          {/* Error Recovery Panel */}
          {error && (
            <div
              role="alert"
              className="mt-6 w-full max-w-md rounded-2xl bg-[#182028] border border-[#E06C75]/45 p-4 text-left space-y-3"
            >
              <div className="flex items-start gap-2.5 text-sm text-[#EDE9E0]">
                <AlertCircle className="w-5 h-5 text-[#E06C75] shrink-0 mt-0.5" aria-hidden="true" />
                <p className="leading-relaxed">{error}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openAudiobook(activeBook, { autoPlay: true })}
                  className="min-h-[44px] px-4 rounded-xl bg-[#212B36] border border-[#2A3642] text-xs font-medium text-[#EDE9E0] hover:bg-[#283442] transition-colors"
                >
                  Tentar novamente
                </button>
                <button
                  type="button"
                  onClick={handleBack}
                  className="min-h-[44px] px-4 rounded-xl text-xs font-medium text-[#96A2AE] hover:text-[#EDE9E0] transition-colors"
                >
                  Voltar à biblioteca
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Bottom Thumb-Zone Controls (Right Column on Desktop) */}
        <section
          className="lg:col-span-6 w-full max-w-md mx-auto lg:max-w-none space-y-7 pb-2"
          aria-label="Controles de reprodução"
        >
          {/* Interactive Timeline Scrubber */}
          <div className="space-y-1">
            <div className="relative flex items-center">
              <div
                className="pointer-events-none absolute left-0 right-0 h-[4px] rounded-full"
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

            <div className="flex items-center justify-between text-xs text-[#96A2AE] tabular-nums">
              <span>{formatTime(displayTime)}</span>
              <span>{effectiveDuration > 0 ? `-${formatTime(remaining)}` : '--:--'}</span>
            </div>
          </div>

          {/* Primary Transport Buttons: -15s | Play/Pause | +30s */}
          <div className="flex items-center justify-center gap-8 sm:gap-11">
            <button
              type="button"
              onClick={() => seekBy(-15)}
              disabled={effectiveDuration <= 0}
              className="w-14 h-14 rounded-full bg-[#182028] border border-[#2A3642] flex flex-col items-center justify-center text-[#EDE9E0] hover:bg-[#212B36] active:scale-95 disabled:opacity-40 transition"
              aria-label="Retroceder 15 segundos"
            >
              <RotateCcw className="w-4 h-4 text-[#96A2AE]" strokeWidth={1.9} aria-hidden="true" />
              <span className="text-[11px] font-medium tabular-nums leading-none mt-1 text-[#EDE9E0]">
                15s
              </span>
            </button>

            <button
              type="button"
              onClick={() => void togglePlayPause()}
              disabled={isLoading}
              className="w-[74px] h-[74px] rounded-full bg-[#E0A458] text-[#11161C] flex items-center justify-center hover:bg-[#ECB56F] active:scale-95 disabled:opacity-60 transition"
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
              className="w-14 h-14 rounded-full bg-[#182028] border border-[#2A3642] flex flex-col items-center justify-center text-[#EDE9E0] hover:bg-[#212B36] active:scale-95 disabled:opacity-40 transition"
              aria-label="Avançar 30 segundos"
            >
              <RotateCw className="w-4 h-4 text-[#96A2AE]" strokeWidth={1.9} aria-hidden="true" />
              <span className="text-[11px] font-medium tabular-nums leading-none mt-1 text-[#EDE9E0]">
                30s
              </span>
            </button>
          </div>

          {/* Clean 6-Stop Playback Speed Strip */}
          <div className="pt-2 border-t border-[#2A3642]/70">
            <div
              role="radiogroup"
              aria-label="Velocidade de reprodução"
              className="grid grid-cols-6 gap-1 pt-2"
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
                    className={`min-h-[44px] rounded-lg text-xs sm:text-sm tabular-nums transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'bg-[#212B36] text-[#E0A458] font-semibold border border-[#E0A458]/40'
                        : 'text-[#96A2AE] hover:text-[#EDE9E0] hover:bg-[#182028]'
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
