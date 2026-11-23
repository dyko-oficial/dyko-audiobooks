import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card' | 'menu';
  onAction?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header',
  onAction,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    if (variant === 'menu') {
      return (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onAction?.();
            void install();
          }}
          className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
          aria-label="Instalar aplicativo Dyko Audiobooks"
        >
          <Download className="w-4 h-4 text-[#E0A458] shrink-0" aria-hidden="true" />
          <span>Instalar aplicativo</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => {
          onAction?.();
          void install();
        }}
        className={
          variant === 'header'
            ? 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-[#182028] border border-[#2A3642] text-xs font-medium text-[#EDE9E0] hover:bg-[#212B36] active:scale-[0.98] transition whitespace-nowrap shrink-0'
            : 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-[#182028] border border-[#2A3642] text-sm font-medium text-[#EDE9E0] hover:bg-[#212B36] active:scale-[0.98] transition whitespace-nowrap shrink-0'
        }
        aria-label="Instalar aplicativo Dyko Audiobooks"
      >
        <Download className="w-4 h-4 text-[#E0A458]" aria-hidden="true" />
        <span>Instalar aplicativo</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        {variant === 'menu' ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => setShowIOSGuide(true)}
            className="w-full min-h-[44px] px-4 flex items-center gap-3 text-left text-sm text-[#EDE9E0] hover:bg-[#283442] transition-colors"
          >
            <Share className="w-4 h-4 text-[#E0A458] shrink-0" aria-hidden="true" />
            <span>Instalar no iOS</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className={
              variant === 'header'
                ? 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-[#182028] border border-[#2A3642] text-xs font-medium text-[#EDE9E0] hover:bg-[#212B36] transition whitespace-nowrap shrink-0'
                : 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-[#182028] border border-[#2A3642] text-sm font-medium text-[#EDE9E0] hover:bg-[#212B36] transition whitespace-nowrap shrink-0'
            }
          >
            <Share className="w-4 h-4 text-[#E0A458]" aria-hidden="true" />
            <span>Instalar no iOS</span>
          </button>
        )}

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#090C10]/80 backdrop-blur-xs p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl bg-[#182028] border-t sm:border border-[#2A3642] p-6 pb-safe">
              <div className="w-10 h-1 rounded-full bg-[#2A3642] mx-auto mb-4 sm:hidden" aria-hidden="true" />
              <div className="flex items-center justify-between gap-4">
                <h3 id="ios-install-title" className="font-display text-lg font-medium text-[#EDE9E0]">
                  Instalar na Tela de Início
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowIOSGuide(false);
                    onAction?.();
                  }}
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-lg text-[#96A2AE] hover:text-[#EDE9E0]"
                  aria-label="Fechar instruções"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-[#96A2AE] list-decimal list-inside leading-relaxed">
                <li>
                  Toque em <strong className="text-[#EDE9E0] font-medium">Compartilhar</strong> na barra do Safari.
                </li>
                <li>
                  Selecione <strong className="text-[#EDE9E0] font-medium">Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  Toque em <strong className="text-[#EDE9E0] font-medium">Adicionar</strong> para concluir.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => {
                  setShowIOSGuide(false);
                  onAction?.();
                }}
                className="mt-6 w-full min-h-[44px] rounded-xl bg-[#E0A458] text-[#11161C] text-sm font-semibold hover:bg-[#ECB56F] transition"
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
