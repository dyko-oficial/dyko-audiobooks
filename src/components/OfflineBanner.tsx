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
      className="bg-[#182028] border-b border-[#2A3642] px-4 py-2 text-xs text-[#96A2AE]"
    >
      <div className="max-w-5xl mx-auto flex items-center justify-center gap-2">
        <WifiOff className="w-3.5 h-3.5 text-[#E0A458] shrink-0" aria-hidden="true" />
        <span>Sem conexão. Seus audiolivros locais seguem disponíveis.</span>
      </div>
    </div>
  );
};
