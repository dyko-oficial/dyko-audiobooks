import type { AudiobookStatus, PlaybackRate } from '../types/audiobook';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const paddedSecs = String(secs).padStart(2, '0');
  if (hours > 0) {
    const paddedMins = String(minutes).padStart(2, '0');
    return `${hours}:${paddedMins}:${paddedSecs}`;
  }
  return `${minutes}:${paddedSecs}`;
}

export function formatDurationHuman(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'Duração indisponível';
  }
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}min`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${Math.max(1, minutes)}min`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2).replace('.', ',')} GB`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1).replace('.', ',')} MB`;
  }
  const kb = bytes / 1024;
  return `${Math.round(kb)} KB`;
}

export function formatRate(rate: PlaybackRate | number): string {
  const formatted = rate.toFixed(rate % 1 === 0 ? 1 : rate * 10 % 1 === 0 ? 1 : 2);
  return `${formatted.replace('.', ',')}x`;
}

export function cleanAudiobookTitle(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '');
  const normalized = withoutExt.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return normalized || fileName;
}

export function getStatusLabel(status: AudiobookStatus): string {
  switch (status) {
    case 'not_started':
      return 'Não iniciado';
    case 'in_progress':
      return 'Em andamento';
    case 'completed':
      return 'Concluído';
  }
}

export function calculateProgressPercent(currentTime: number, duration: number, status: AudiobookStatus): number {
  if (status === 'completed') return 100;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime) || currentTime <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)));
}
