import React from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { useAudioController } from '../playback/audioController';
import { calculateProgressPercent, formatTime } from '../utils/format';

interface MiniPlayerProps {
  onOpenPlayer: () => void;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({ onOpenPlayer }) => {
  const { activeBook, isPlaying, isLoading, currentTime, duration, togglePlayPause } =
    useAudioController();

  if (!activeBook) return null;

  const effectiveDuration = duration > 0 ? duration : activeBook.duration;
  const percent = calculateProgressPercent(currentTime, effectiveDuration, activeBook.status);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 bg-[#182028]/95 backdrop-blur-md border-t border-[#2A3642] pb-safe"
      role="region"
      aria-label="Reprodução atual"
    >
      {/* 2px brass bookmark progress rule along top edge */}
      <div className="w-full h-[2px] bg-[#2A3642]">
        <div
          className="h-full bg-[#E0A458] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="max-w-5xl mx-auto h-16 px-4 sm:px-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenPlayer}
          className="flex-1 min-w-0 min-h-[48px] flex items-center gap-3 text-left rounded-lg focus-visible:outline-[#E0A458]"
          aria-label={`Abrir player para ${activeBook.customName}`}
        >
          {/* Vertical bookmark progress indicator */}
          <div
            className="w-1 h-9 rounded-full bg-[#2A3642] overflow-hidden flex flex-col justify-end shrink-0"
            aria-hidden="true"
          >
            <div
              className="w-full bg-[#E0A458] rounded-full transition-all duration-300"
              style={{ height: `${Math.max(12, percent)}%` }}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-medium text-[#EDE9E0] truncate leading-snug">
              {activeBook.customName}
            </p>
            <p className="text-xs text-[#96A2AE] tabular-nums truncate mt-0.5">
              {formatTime(currentTime)}
              {effectiveDuration > 0 ? ` de ${formatTime(effectiveDuration)}` : ''}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => void togglePlayPause()}
          disabled={isLoading}
          className="min-h-[44px] min-w-[44px] rounded-full bg-[#E0A458] text-[#11161C] flex items-center justify-center hover:bg-[#ECB56F] active:scale-95 disabled:opacity-60 transition shrink-0"
          aria-label={isPlaying ? 'Pausar audiolivro' : 'Reproduzir audiolivro'}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          ) : isPlaying ? (
            <Pause className="w-5 h-5 fill-current" aria-hidden="true" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
};
