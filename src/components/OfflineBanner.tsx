import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-[#1C1C1C] border-b border-[#2E2E2E] px-4 py-2 text-xs text-[#A0A0A0]"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
        <WifiOff className="w-3.5 h-3.5 text-[#B5A58A] shrink-0" aria-hidden="true" />
        <span>Modo offline ativo — seus audiolivros locais continuam disponíveis.</span>
      </div>
    </div>
  );
};
