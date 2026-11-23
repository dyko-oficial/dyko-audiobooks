import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FolderOpen, HardDrive, Upload, X } from 'lucide-react';
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
          : 'Não foi possível acessar a pasta. Use a opção de selecionar arquivos MP3 ou MP4.'
      );
    }
  };

  const content = (
    <div className={isModal ? 'w-full' : 'w-full max-w-xl mx-auto'}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/mpeg,.mp3,video/mp4,audio/mp4,.mp4,.m4a,audio/*"
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />

      {isModal ? (
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display text-xl font-medium text-[#EDE9E0]">
              Importar audiolivros
            </h2>
            <p className="text-xs sm:text-sm text-[#96A2AE] mt-1 leading-relaxed">
              Arquivos MP3, M4A e MP4 são copiados para o armazenamento local. Itens já presentes na
              biblioteca não são duplicados.
            </p>
          </div>
          {onClose && !isImporting && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-[#96A2AE] hover:text-[#EDE9E0] hover:bg-[#212B36] transition-colors shrink-0"
              aria-label="Fechar janela de importação"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      ) : (
        <div className="mb-9">
          <p className="font-display text-base text-[#E0A458] font-medium">Dyko Audiobooks</p>
          <h1 className="mt-3 font-display text-3xl sm:text-4xl font-medium tracking-tight text-[#EDE9E0] leading-[1.15] text-balance">
            Sua estante de audiolivros, sempre offline
          </h1>
          <p className="mt-4 text-sm sm:text-base text-[#96A2AE] leading-relaxed max-w-md">
            Importe arquivos MP3 ou MP4 do seu aparelho para ouvir sem internet e retomar exatamente
            do segundo em que parou.
          </p>
        </div>
      )}

      {/* Primary Action Area */}
      <div className="space-y-3">
        <button
          type="button"
          disabled={isImporting}
          onClick={handleSelectFilesClick}
          className="w-full min-h-[52px] px-5 py-3 rounded-xl bg-[#E0A458] text-[#11161C] font-semibold text-base flex items-center justify-center gap-2.5 hover:bg-[#ECB56F] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <Upload className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span>Importar arquivos</span>
        </button>

        {supportsDirectory && (
          <button
            type="button"
            disabled={isImporting}
            onClick={() => void handleSelectDirectoryClick()}
            className="w-full min-h-[48px] px-5 py-2.5 rounded-xl bg-[#182028] border border-[#2A3642] text-[#EDE9E0] font-medium text-sm flex items-center justify-center gap-2 hover:bg-[#212B36] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <FolderOpen className="w-4 h-4 text-[#E0A458] shrink-0" aria-hidden="true" />
            <span>Selecionar pasta</span>
          </button>
        )}

        <div className="pt-4 mt-2 border-t border-[#2A3642]/70 flex items-start gap-3 text-xs text-[#96A2AE] leading-relaxed">
          <HardDrive className="w-4 h-4 text-[#E0A458] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p>
              Cópias locais ficam salvas no aparelho e seus arquivos originais nunca são alterados
              ou excluídos.
            </p>
            {storageInfo?.supported && (
              <p className="tabular-nums">
                Espaço disponível estimado:{' '}
                <span className="text-[#EDE9E0] font-medium">
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
          className="mt-5 rounded-xl bg-[#182028] border border-[#2A3642] p-4 space-y-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-[#EDE9E0] truncate">
              {progress.phase === 'scanning'
                ? 'Lendo pasta...'
                : progress.phase === 'checking'
                  ? 'Verificando arquivos...'
                  : progress.phase === 'remuxing'
                    ? `Extraindo áudio ${progress.processedFiles + 1} de ${progress.totalFiles}`
                    : `Copiando ${progress.processedFiles + 1} de ${progress.totalFiles}`}
            </span>
            <span className="text-xs font-medium text-[#E0A458] tabular-nums shrink-0">
              {progress.overallPercent}%
            </span>
          </div>

          <div className="w-full h-1.5 rounded-full bg-[#2A3642] overflow-hidden">
            <div
              className="h-full bg-[#E0A458] transition-all duration-150"
              style={{ width: `${Math.max(4, progress.overallPercent)}%` }}
            />
          </div>

          {progress.currentFileName && (
            <p className="text-xs text-[#96A2AE] truncate">{progress.currentFileName}</p>
          )}
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div
          role="alert"
          className="mt-5 rounded-xl bg-[#212B36] border border-[#E06C75]/45 p-4 flex items-start gap-3 text-sm text-[#EDE9E0]"
        >
          <AlertCircle className="w-5 h-5 text-[#E06C75] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Import Result Summary */}
      {result && !isImporting && (
        <div className="mt-5 rounded-xl bg-[#11161C] border border-[#2A3642] p-4 space-y-2.5 text-sm">
          {result.insufficientStorage && (
            <div className="flex items-start gap-2.5 text-[#E06C75]">
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
            <div className="flex items-center gap-2.5 text-[#EDE9E0]">
              <CheckCircle2 className="w-5 h-5 text-[#E0A458] shrink-0" aria-hidden="true" />
              <span>
                {result.imported.length === 1
                  ? '1 audiolivro importado com sucesso.'
                  : `${result.imported.length} audiolivros importados com sucesso.`}
              </span>
            </div>
          )}

          {result.imported.length === 0 &&
            result.duplicates.length > 0 &&
            result.failed.length === 0 &&
            !result.insufficientStorage && (
              <div className="flex items-start gap-2.5 text-[#EDE9E0]">
                <CheckCircle2 className="w-5 h-5 text-[#E0A458] shrink-0 mt-0.5" aria-hidden="true" />
                <span className="leading-relaxed">
                  {result.duplicates.length === 1
                    ? 'Este arquivo já está na sua biblioteca e não foi importado novamente.'
                    : `Todos os ${result.duplicates.length} arquivos selecionados já estão na biblioteca e não foram importados novamente.`}
                </span>
              </div>
            )}

          {result.duplicates.length > 0 &&
            (result.imported.length > 0 ||
              result.failed.length > 0 ||
              Boolean(result.insufficientStorage)) && (
              <p className="text-xs text-[#96A2AE]">
                {result.duplicates.length === 1
                  ? '1 arquivo já estava na biblioteca e não foi importado novamente.'
                  : `${result.duplicates.length} arquivos já estavam na biblioteca e não foram importados novamente.`}
              </p>
            )}

          {result.unsupportedCount > 0 && (
            <p className="text-xs text-[#96A2AE]">
              {result.unsupportedCount === 1
                ? '1 arquivo ignorado por não ser MP3, M4A ou MP4.'
                : `${result.unsupportedCount} arquivos ignorados por não serem MP3, M4A ou MP4.`}
            </p>
          )}

          {result.optimizedCount > 0 && (
            <p className="text-xs text-[#96A2AE]">
              {result.optimizedCount === 1
                ? '1 MP4 teve o áudio isolado sem vídeo para reprodução contínua em segundo plano.'
                : `${result.optimizedCount} MP4s tiveram o áudio isolado sem vídeo para reprodução contínua em segundo plano.`}
            </p>
          )}

          {result.warnings.length > 0 && (
            <div className="space-y-2 pt-1">
              {result.warnings.map((warn) => (
                <div
                  key={warn.fileName}
                  className="rounded-xl bg-[#182028] border border-[#E0A458]/35 p-3 flex items-start gap-2.5 text-xs text-[#EDE9E0]"
                >
                  <AlertCircle className="w-4 h-4 text-[#E0A458] shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="leading-relaxed">
                    <span className="font-medium">{warn.fileName}:</span> {warn.message}
                  </p>
                </div>
              ))}
            </div>
          )}

          {result.failed.length > 0 && (
            <div className="space-y-1 pt-1">
              {result.failed.map((item) => (
                <p key={item.fileName} className="text-xs text-[#E06C75]">
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
                className="w-full min-h-[44px] rounded-xl bg-[#212B36] border border-[#2A3642] text-sm font-medium text-[#EDE9E0] hover:bg-[#283442] transition-colors"
              >
                Voltar à biblioteca
              </button>
            </div>
          )}
        </div>
      )}

      {!isModal && (
        <div className="mt-8">
          <PWAInstallButton variant="card" />
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#090C10]/80 backdrop-blur-xs p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Importar audiolivros"
      >
        <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-[#182028] border-t sm:border border-[#2A3642] p-6 pb-safe max-h-[90dvh] overflow-y-auto">
          <div className="w-10 h-1 rounded-full bg-[#2A3642] mx-auto mb-5 sm:hidden" aria-hidden="true" />
          {content}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] flex flex-col justify-center px-6 py-12 bg-[#11161C]">
      {content}
    </main>
  );
};
