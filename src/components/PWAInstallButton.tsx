import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={
          variant === 'header'
            ? 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-[#242424] border border-[#2E2E2E] text-xs font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] active:scale-[0.98] transition whitespace-nowrap shrink-0'
            : 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-[#1C1C1C] border border-[#2E2E2E] text-sm font-medium text-[#F0F0F0] hover:bg-[#242424] active:scale-[0.98] transition whitespace-nowrap shrink-0'
        }
        aria-label="Instalar aplicativo Dyko Audiobooks"
      >
        <Download className="w-4 h-4 text-[#B5A58A]" aria-hidden="true" />
        <span>Instalar app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'header'
              ? 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-[#242424] border border-[#2E2E2E] text-xs font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] transition whitespace-nowrap shrink-0'
              : 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-[#1C1C1C] border border-[#2E2E2E] text-sm font-medium text-[#F0F0F0] hover:bg-[#242424] transition whitespace-nowrap shrink-0'
          }
        >
          <Share className="w-4 h-4 text-[#B5A58A]" aria-hidden="true" />
          <span>Instalar no iOS</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-2xl bg-[#1C1C1C] border border-[#2E2E2E] p-6">
              <div className="flex items-center justify-between gap-4">
                <h3 id="ios-install-title" className="text-base font-semibold text-[#F0F0F0]">
                  Instalar na Tela de Início
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-lg text-[#A0A0A0] hover:text-[#F0F0F0]"
                  aria-label="Fechar instruções"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-[#A0A0A0] list-decimal list-inside leading-relaxed">
                <li>
                  Toque no botão <strong className="text-[#F0F0F0] font-medium">Compartilhar</strong> na barra do Safari.
                </li>
                <li>
                  Role a lista e toque em{' '}
                  <strong className="text-[#F0F0F0] font-medium">Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  Confirme tocando em <strong className="text-[#F0F0F0] font-medium">Adicionar</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full min-h-[44px] rounded-xl bg-[#242424] border border-[#2E2E2E] text-sm font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
              >
                Entendi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
