import React from 'react';
import { Headphones, Loader2, Pause, Play } from 'lucide-react';
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
      className="fixed bottom-0 left-0 right-0 z-30 bg-[#1C1C1C] border-t border-[#2E2E2E] pb-safe"
      role="region"
      aria-label="Reprodução atual"
    >
      {/* Subtle 2px progress line at top edge */}
      <div className="w-full h-[2px] bg-[#2E2E2E]">
        <div
          className="h-full bg-[#B5A58A] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="max-w-4xl mx-auto h-16 px-3 sm:px-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenPlayer}
          className="flex-1 min-w-0 min-h-[48px] flex items-center gap-3 text-left rounded-lg focus-visible:outline-[#B5A58A]"
          aria-label={`Abrir player para ${activeBook.customName}`}
        >
          <div className="w-10 h-10 rounded-xl bg-[#242424] border border-[#2E2E2E] flex items-center justify-center shrink-0">
            <Headphones className="w-5 h-5 text-[#B5A58A]" strokeWidth={1.75} aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#F0F0F0] truncate">{activeBook.customName}</p>
            <p className="text-xs text-[#A0A0A0] font-mono tabular-nums truncate mt-0.5">
              {formatTime(currentTime)}
              {effectiveDuration > 0 ? ` / ${formatTime(effectiveDuration)}` : ''}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => void togglePlayPause()}
          disabled={isLoading}
          className="min-h-[44px] min-w-[44px] rounded-full bg-[#B5A58A] text-[#121212] flex items-center justify-center hover:bg-[#C6B79E] active:scale-95 disabled:opacity-60 transition shrink-0"
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
