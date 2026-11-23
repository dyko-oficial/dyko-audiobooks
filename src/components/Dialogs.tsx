import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AudiobookRecord } from '../types/audiobook';

interface RenameDialogProps {
  book: AudiobookRecord | null;
  onCancel: () => void;
  onConfirm: (bookId: string, newName: string) => Promise<void>;
}

export const RenameDialog: React.FC<RenameDialogProps> = ({ book, onCancel, onConfirm }) => {
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (book) {
      setName(book.customName);
      setIsSaving(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [book]);

  if (!book) return null;

  const trimmed = name.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    try {
      await onConfirm(book.id, trimmed);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#090C10]/80 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-dialog-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#182028] border-t sm:border border-[#2A3642] p-6 pb-safe">
        <div className="w-10 h-1 rounded-full bg-[#2A3642] mx-auto mb-4 sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 id="rename-dialog-title" className="font-display text-lg font-medium text-[#EDE9E0]">
            Renomear audiolivro
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#96A2AE] hover:text-[#EDE9E0] hover:bg-[#212B36] transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="audiobook-name-input" className="block text-xs text-[#96A2AE] mb-2">
              Título na biblioteca
            </label>
            <input
              ref={inputRef}
              id="audiobook-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={180}
              className="w-full min-h-[48px] px-3.5 rounded-xl bg-[#11161C] border border-[#2A3642] text-sm text-[#EDE9E0] placeholder:text-[#96A2AE]/60 focus:border-[#E0A458] focus:outline-none transition-colors"
              placeholder="Digite o título do audiolivro"
            />
            <p className="mt-2 text-xs text-[#96A2AE] truncate">
              Arquivo: {book.originalName}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] px-4 rounded-xl bg-[#212B36] border border-[#2A3642] text-sm font-medium text-[#EDE9E0] hover:bg-[#283442] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!trimmed || isSaving}
              className="min-h-[44px] px-5 rounded-xl bg-[#E0A458] text-[#11161C] text-sm font-semibold hover:bg-[#ECB56F] disabled:opacity-50 transition-colors"
            >
              {isSaving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  isBusy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  destructive = true,
  isBusy = false,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#090C10]/80 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#182028] border-t sm:border border-[#2A3642] p-6 pb-safe">
        <div className="w-10 h-1 rounded-full bg-[#2A3642] mx-auto mb-4 sm:hidden" aria-hidden="true" />
        <h2 id="confirm-dialog-title" className="font-display text-lg font-medium text-[#EDE9E0]">
          {title}
        </h2>
        <p className="mt-2.5 text-sm text-[#96A2AE] leading-relaxed">{description}</p>

        <div className="mt-6 grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-3">
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="min-h-[44px] px-4 rounded-xl bg-[#212B36] border border-[#2A3642] text-sm font-medium text-[#EDE9E0] hover:bg-[#283442] disabled:opacity-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
            className={
              destructive
                ? 'min-h-[44px] px-5 rounded-xl bg-[#E06C75] text-[#11161C] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition'
                : 'min-h-[44px] px-5 rounded-xl bg-[#E0A458] text-[#11161C] text-sm font-semibold hover:bg-[#ECB56F] disabled:opacity-50 transition-colors'
            }
          >
            {isBusy ? 'Removendo...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
