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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-dialog-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#1C1C1C] border-t sm:border border-[#2E2E2E] p-6 pb-safe">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 id="rename-dialog-title" className="text-base font-semibold text-[#F0F0F0]">
            Renomear audiolivro
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#A0A0A0] hover:text-[#F0F0F0]"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="audiobook-name-input" className="block text-xs text-[#A0A0A0] mb-1.5">
              Nome exibido no aplicativo
            </label>
            <input
              ref={inputRef}
              id="audiobook-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={180}
              className="w-full min-h-[48px] px-3.5 rounded-xl bg-[#121212] border border-[#2E2E2E] text-sm text-[#F0F0F0] placeholder:text-[#A0A0A0]/60 focus:border-[#B5A58A] focus:outline-none"
              placeholder="Digite o nome do audiolivro"
            />
            <p className="mt-2 text-xs text-[#A0A0A0] truncate">
              Arquivo original: {book.originalName}
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] px-4 rounded-xl bg-[#242424] border border-[#2E2E2E] text-sm font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!trimmed || isSaving}
              className="min-h-[44px] px-5 rounded-xl bg-[#B5A58A] text-[#121212] text-sm font-semibold hover:bg-[#C6B79E] disabled:opacity-50 transition"
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#1C1C1C] border-t sm:border border-[#2E2E2E] p-6 pb-safe">
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-[#F0F0F0]">
          {title}
        </h2>
        <p className="mt-2.5 text-sm text-[#A0A0A0] leading-relaxed">{description}</p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="min-h-[44px] px-4 rounded-xl bg-[#242424] border border-[#2E2E2E] text-sm font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] disabled:opacity-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
            className={
              destructive
                ? 'min-h-[44px] px-5 rounded-xl bg-[#CF6679] text-[#121212] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition'
                : 'min-h-[44px] px-5 rounded-xl bg-[#B5A58A] text-[#121212] text-sm font-semibold hover:bg-[#C6B79E] disabled:opacity-50 transition'
            }
          >
            {isBusy ? 'Removendo...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
