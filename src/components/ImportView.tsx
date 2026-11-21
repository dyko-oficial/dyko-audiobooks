import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FolderOpen, HardDrive, Headphones, Upload, X } from 'lucide-react';
import type {
  AudiobookRecord,
  ImportProgress,
  ImportResult,
  StorageEstimateInfo,
} from '../types/audiobook';
import {
  importAudioFiles,
  isDirectoryPickerSupported,
  pickFilesFromDirectory,
} from '../import/importManager';
import { getStorageEstimate } from '../storage/fileStorage';
import { formatFileSize } from '../utils/format';
import { PWAInstallButton } from './PWAInstallButton';

interface ImportViewProps {
  existingBooks: AudiobookRecord[];
  onImportComplete: (newBooks: AudiobookRecord[], summary: ImportResult) => void;
  /** When true, rendered as a modal sheet over the Library rather than the full first-run screen */
  isModal?: boolean;
  onClose?: () => void;
}

export const ImportView: React.FC<ImportViewProps> = ({
  existingBooks,
  onImportComplete,
  isModal = false,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const supportsDirectory = isDirectoryPickerSupported();

  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageEstimateInfo | null>(null);

  const refreshStorage = async () => {
    const info = await getStorageEstimate();
    setStorageInfo(info);
  };

  useEffect(() => {
    void refreshStorage();
  }, []);

  const runImport = async (files: File[]) => {
    if (files.length === 0) return;

    setIsImporting(true);
    setErrorMessage(null);
    setResult(null);

    try {
      const importResult = await importAudioFiles(files, existingBooks, (prog) => {
        setProgress(prog);
      });

      setResult(importResult);
      await refreshStorage();

      if (importResult.imported.length > 0) {
        onImportComplete(importResult.imported, importResult);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Não foi possível concluir a importação dos arquivos selecionados.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleSelectFilesClick = () => {
    setErrorMessage(null);
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = '';
    void runImport(files);
  };

  const handleSelectDirectoryClick = async () => {
    setErrorMessage(null);
    setResult(null);
    try {
      setProgress({
        phase: 'scanning',
        totalFiles: 0,
        processedFiles: 0,
        currentFileName: 'Lendo arquivos da pasta selecionada...',
        currentFilePercent: 0,
        overallPercent: 0,
      });
      setIsImporting(true);
      const { files, cancelled } = await pickFilesFromDirectory();
      if (cancelled) {
        setIsImporting(false);
        setProgress(null);
        return;
      }
      if (files.length === 0) {
        setIsImporting(false);
        setProgress(null);
        setErrorMessage('Nenhum arquivo foi encontrado na pasta selecionada.');
        return;
      }
      await runImport(files);
    } catch (err) {
      setIsImporting(false);
      setProgress(null);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Não foi possível acessar a pasta. Use a opção de selecionar arquivos MP3.'
      );
    }
  };

  const content = (
    <div className="w-full max-w-lg mx-auto">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/mpeg,.mp3,audio/*"
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />

      {isModal ? (
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-semibold text-[#F0F0F0]">Importar audiolivros</h2>
            <p className="text-xs text-[#A0A0A0] mt-0.5">
              Os arquivos MP3 serão copiados localmente para reprodução offline.
            </p>
          </div>
          {onClose && !isImporting && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#A0A0A0] hover:text-[#F0F0F0] hover:bg-[#242424] transition"
              aria-label="Fechar janela de importação"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      ) : (
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-[#1C1C1C] border border-[#2E2E2E] flex items-center justify-center mx-auto mb-5">
            <Headphones className="w-8 h-8 text-[#B5A58A]" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#F0F0F0] text-balance">
            Dyko Audiobooks
          </h1>
          <p className="mt-3 text-sm sm:text-base text-[#A0A0A0] leading-relaxed max-w-md mx-auto">
            Importe seus audiolivros em MP3 para ouvir offline, organizar sua biblioteca pessoal e
            retomar exatamente de onde parou.
          </p>
        </div>
      )}

      {/* Primary Action Area */}
      <div className={isModal ? 'space-y-3' : 'rounded-2xl bg-[#1C1C1C] border border-[#2E2E2E] p-6 space-y-4'}>
        <button
          type="button"
          disabled={isImporting}
          onClick={handleSelectFilesClick}
          className="w-full min-h-[52px] px-5 py-3 rounded-xl bg-[#B5A58A] text-[#121212] font-semibold text-base flex items-center justify-center gap-2.5 hover:bg-[#C6B79E] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <Upload className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span>Importar audiolivros</span>
        </button>

        {supportsDirectory && (
          <button
            type="button"
            disabled={isImporting}
            onClick={() => void handleSelectDirectoryClick()}
            className="w-full min-h-[48px] px-5 py-2.5 rounded-xl bg-[#242424] border border-[#2E2E2E] text-[#F0F0F0] font-medium text-sm flex items-center justify-center gap-2 hover:bg-[#2C2C2C] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <FolderOpen className="w-4 h-4 text-[#B5A58A] shrink-0" aria-hidden="true" />
            <span>Selecionar pasta de audiolivros</span>
          </button>
        )}

        <div className="pt-2 flex items-start gap-2.5 text-xs text-[#A0A0A0] leading-relaxed">
          <HardDrive className="w-4 h-4 text-[#B5A58A] shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p>
              Os arquivos são copiados para o armazenamento local do dispositivo e reproduzidos
              totalmente offline. Seus arquivos originais nunca são alterados ou excluídos.
            </p>
            {storageInfo?.supported && (
              <p className="mt-1.5 text-[#A0A0A0] tabular-nums">
                Espaço disponível estimado:{' '}
                <span className="text-[#F0F0F0] font-medium">
                  {formatFileSize(storageInfo.available)}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Active Import Progress */}
      {isImporting && progress && (
        <div
          className="mt-4 rounded-2xl bg-[#1C1C1C] border border-[#2E2E2E] p-4 space-y-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-[#F0F0F0] truncate">
              {progress.phase === 'scanning'
                ? 'Lendo pasta...'
                : progress.phase === 'checking'
                  ? 'Verificando arquivos...'
                  : `Copiando ${progress.processedFiles + 1} de ${progress.totalFiles}`}
            </span>
            <span className="font-mono text-xs text-[#B5A58A] tabular-nums shrink-0">
              {progress.overallPercent}%
            </span>
          </div>

          <div className="w-full h-1.5 rounded-full bg-[#2E2E2E] overflow-hidden">
            <div
              className="h-full bg-[#B5A58A] transition-all duration-150"
              style={{ width: `${Math.max(4, progress.overallPercent)}%` }}
            />
          </div>

          {progress.currentFileName && (
            <p className="text-xs text-[#A0A0A0] truncate">{progress.currentFileName}</p>
          )}
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div
          role="alert"
          className="mt-4 rounded-2xl bg-[#242424] border border-[#CF6679]/40 p-4 flex items-start gap-3 text-sm text-[#F0F0F0]"
        >
          <AlertCircle className="w-5 h-5 text-[#CF6679] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Import Result Summary */}
      {result && !isImporting && (
        <div className="mt-4 rounded-2xl bg-[#1C1C1C] border border-[#2E2E2E] p-4 space-y-2.5 text-sm">
          {result.insufficientStorage && (
            <div className="flex items-start gap-2.5 text-[#CF6679]">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">
                Armazenamento insuficiente. Necessário:{' '}
                <strong className="tabular-nums">
                  {formatFileSize(result.insufficientStorage.requiredBytes)}
                </strong>
                . Disponível:{' '}
                <strong className="tabular-nums">
                  {formatFileSize(result.insufficientStorage.availableBytes)}
                </strong>
                .
              </p>
            </div>
          )}

          {result.imported.length > 0 && (
            <div className="flex items-center gap-2.5 text-[#F0F0F0]">
              <CheckCircle2 className="w-5 h-5 text-[#B5A58A] shrink-0" aria-hidden="true" />
              <span>
                {result.imported.length === 1
                  ? '1 audiolivro importado com sucesso.'
                  : `${result.imported.length} audiolivros importados com sucesso.`}
              </span>
            </div>
          )}

          {result.duplicates.length > 0 && (
            <p className="text-xs text-[#A0A0A0]">
              {result.duplicates.length === 1
                ? '1 arquivo ignorado por já estar na biblioteca.'
                : `${result.duplicates.length} arquivos ignorados por já estarem na biblioteca.`}
            </p>
          )}

          {result.unsupportedCount > 0 && (
            <p className="text-xs text-[#A0A0A0]">
              {result.unsupportedCount === 1
                ? '1 arquivo ignorado por não ser formato MP3 suportado.'
                : `${result.unsupportedCount} arquivos ignorados por não serem formato MP3 suportado.`}
            </p>
          )}

          {result.failed.length > 0 && (
            <div className="space-y-1 pt-1">
              {result.failed.map((item) => (
                <p key={item.fileName} className="text-xs text-[#CF6679]">
                  {item.fileName}: {item.reason}
                </p>
              ))}
            </div>
          )}

          {isModal && onClose && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] rounded-xl bg-[#242424] border border-[#2E2E2E] text-sm font-medium text-[#F0F0F0] hover:bg-[#2C2C2C] transition"
              >
                Voltar à biblioteca
              </button>
            </div>
          )}
        </div>
      )}

      {!isModal && (
        <div className="mt-6 flex justify-center">
          <PWAInstallButton variant="card" />
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Importar audiolivros"
      >
        <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-[#1C1C1C] border-t sm:border border-[#2E2E2E] p-5 sm:p-6 pb-safe max-h-[90dvh] overflow-y-auto">
          <div className="w-10 h-1 rounded-full bg-[#2E2E2E] mx-auto mb-4 sm:hidden" aria-hidden="true" />
          {content}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] flex flex-col justify-center px-5 py-10 bg-[#121212]">
      {content}
    </main>
  );
};
