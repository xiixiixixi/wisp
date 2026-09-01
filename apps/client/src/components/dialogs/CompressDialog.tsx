import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import {
  TauriAPI,
  type CompressionOptions,
  type CompressionFormat,
  type CompressionInfo,
  type FileEntry,
} from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import { AlertTriangle, Archive, FolderOpen, X } from 'lucide-react';

interface CompressDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  files: FileEntry[];
}

const FORMAT_BUTTONS: CompressionFormat[] = ['Zip', 'TarGz', 'TarBz2', 'SevenZ'];

const CompressDialog = ({ isOpen, onClose, onComplete, files }: CompressDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [compressionInfo, setCompressionInfo] = useState<CompressionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [outputPath, setOutputPath] = useState('');
  const [format, setFormat] = useState<CompressionFormat>('Zip');
  const [compressionLevel, setCompressionLevel] = useState(6);
  const [password, setPassword] = useState('');
  const [includeHidden, setIncludeHidden] = useState(false);
  const [followSymlinks, setFollowSymlinks] = useState(true);

  useEffect(() => {
    if (isOpen && files.length > 0) {
      loadCompressionInfo();
      generateDefaultOutputPath();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, files]);

  const loadCompressionInfo = async () => {
    setLoading(true);
    setError(null);

    try {
      const filePaths = files.map((f) => f.path);
      const info = await TauriAPI.getCompressionInfo(filePaths);
      setCompressionInfo(info);
    } catch (err) {
      setError((err as Error).message);
      toast({
        title: t('dialogs.compress.errorLoadingTitle'),
        description: t('dialogs.compress.errorLoadingDesc', { error: (err as Error).message }),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const generateDefaultOutputPath = () => {
    if (files.length === 0) return;

    let baseName: string;
    if (files.length === 1) {
      const file = files[0];
      baseName = file.is_dir ? file.name : file.name.split('.')[0];
    } else {
      baseName = `archive_${files.length}_files`;
    }

    const extension = getExtensionForFormat(format);
    const firstFileDir = files[0].path.split(/[/\\]/).slice(0, -1).join('/');
    setOutputPath(`${firstFileDir}/${baseName}.${extension}`);
  };

  const getExtensionForFormat = (fmt: CompressionFormat): string => {
    switch (fmt) {
      case 'Zip':
        return 'zip';
      case 'Tar':
        return 'tar';
      case 'TarGz':
        return 'tar.gz';
      case 'TarBz2':
        return 'tar.bz2';
      case 'TarXz':
        return 'tar.xz';
      case 'SevenZ':
        return '7z';
      default:
        return 'zip';
    }
  };

  const handleFormatChange = (newFormat: CompressionFormat) => {
    setFormat(newFormat);
    // Update output path extension
    if (outputPath) {
      const pathParts = outputPath.split('.');
      const basePath = pathParts.slice(0, -1).join('.') || pathParts[0];
      const newExtension = getExtensionForFormat(newFormat);
      setOutputPath(`${basePath}.${newExtension}`);
    }
  };

  const handleCompress = async () => {
    if (!outputPath.trim()) {
      toast({
        title: t('dialogs.compress.outputPathRequiredTitle'),
        description: t('dialogs.compress.outputPathRequiredDesc'),
        variant: 'destructive',
      });
      return;
    }

    setCompressing(true);

    try {
      const options: CompressionOptions = {
        format,
        compression_level: compressionLevel,
        password: password.trim() || undefined,
        include_hidden: includeHidden,
        follow_symlinks: followSymlinks,
      };

      const filePaths = files.map((f) => f.path);
      const resultPath = await TauriAPI.compressFiles(filePaths, outputPath, options);

      toast({
        title: t('dialogs.compress.successTitle'),
        description: t('dialogs.compress.successDesc', {
          name: resultPath.split(/[/\\]/).pop(),
        }),
      });

      onComplete?.();
      onClose();
    } catch (err) {
      toast({
        title: t('dialogs.compress.failedTitle'),
        description: t('dialogs.compress.failedDesc', { error: (err as Error).message }),
        variant: 'destructive',
      });
    } finally {
      setCompressing(false);
    }
  };

  const handleClose = () => {
    if (compressing) return; // Don't allow closing during compression

    setOutputPath('');
    setPassword('');
    setError(null);
    onClose();
  };

  const handleBrowseOutputPath = async () => {
    try {
      const result = await TauriAPI.showOpenDialog({
        directory: true,
        multiple: false,
      });

      if (result && result.length > 0) {
        const selectedDir = result[0];
        const currentFileName =
          outputPath.split(/[/\\]/).pop() || `archive.${getExtensionForFormat(format)}`;
        setOutputPath(`${selectedDir}/${currentFileName}`);
      }
    } catch (err) {
      console.error('Failed to open directory dialog:', err);
    }
  };

  const getSizeReduction = (): string => {
    if (!compressionInfo) return '';
    const reduction =
      ((compressionInfo.total_size - compressionInfo.estimated_compressed_size) /
        compressionInfo.total_size) *
      100;
    return t('dialogs.compress.sizeReduction', { percent: Math.round(reduction) });
  };

  if (!isOpen) return null;

  const firstFileName = files[0]?.name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="border-xp-border/60 mx-4 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-xp-surface/95 shadow-2xl shadow-black/30 duration-150 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="border-xp-border/40 flex flex-shrink-0 items-center justify-between border-b px-5 py-3.5">
          <div className="flex min-w-0 items-center space-x-2.5">
            <div className="rounded-md bg-xp-blue/10 p-1.5">
              <Archive className="h-4 w-4 text-xp-blue" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-xp-text">{t('dialogs.compress.title')}</h2>
              <p
                className="max-w-[320px] truncate text-xs text-xp-text-muted"
                title={firstFileName}
              >
                {files.length === 1
                  ? firstFileName
                  : t('dialogs.compress.filesCount', { count: files.length })}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={compressing}
            className="rounded-md p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text disabled:opacity-50"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-xp-border border-b-xp-blue" />
              <span className="ml-3 text-sm text-xp-text-muted">
                {t('dialogs.compress.analyzing')}
              </span>
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-xp-red" />
              <h3 className="mb-1.5 text-sm font-medium text-xp-text">
                {t('dialogs.compress.errorAnalyzingTitle')}
              </h3>
              <p className="mb-4 text-xs text-xp-text-muted">{error}</p>
              <button
                onClick={loadCompressionInfo}
                className="rounded-lg bg-xp-blue px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-xp-blue-dark"
              >
                {t('dialogs.compress.tryAgain')}
              </button>
            </div>
          ) : (
            <>
              {/* Files Summary */}
              {compressionInfo && (
                <div className="border-xp-border/40 bg-xp-bg/60 rounded-lg border px-4 py-3">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xp-text-muted">{t('dialogs.compress.files')}</span>
                      <span className="font-medium text-xp-text">
                        {compressionInfo.total_files.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xp-text-muted">
                        {t('dialogs.compress.directories')}
                      </span>
                      <span className="font-medium text-xp-text">
                        {compressionInfo.total_directories.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xp-text-muted">{t('dialogs.compress.totalSize')}</span>
                      <span className="font-medium text-xp-text">
                        {formatFileSize(compressionInfo.total_size)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xp-text-muted">
                        {t('dialogs.compress.estimatedSize')}
                      </span>
                      <span className="font-medium text-xp-text">
                        {formatFileSize(compressionInfo.estimated_compressed_size)}
                        <span className="ml-1 text-[11px] text-xp-green">
                          ({getSizeReduction()})
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Output Path */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-xp-text">
                  {t('dialogs.compress.outputPath')}
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    className="border-xp-border/60 bg-xp-bg/60 flex-1 rounded-lg border px-3 py-1.5 text-xs text-xp-text focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue/40"
                    placeholder={t('dialogs.compress.outputPathPlaceholder')}
                  />
                  <button
                    onClick={handleBrowseOutputPath}
                    className="border-xp-border/60 rounded-lg border px-2.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                    aria-label={t('dialogs.compress.browseOutputDir')}
                  >
                    <FolderOpen size={15} />
                  </button>
                </div>
              </div>

              {/* Format Selection */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-xp-text">
                  {t('dialogs.compress.format')}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {FORMAT_BUTTONS.map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => handleFormatChange(fmt)}
                      className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                        format === fmt
                          ? 'border-xp-blue/60 bg-xp-blue/10 text-xp-blue'
                          : 'border-xp-border/60 text-xp-text hover:bg-xp-surface-light'
                      }`}
                    >
                      <div className="text-xs font-semibold">{fmt === 'SevenZ' ? '7z' : fmt}</div>
                      <div className="text-[10px] text-xp-text-muted">
                        .{getExtensionForFormat(fmt)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Compression Level */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-xp-text">
                  {t('dialogs.compress.level', { level: compressionLevel })}
                </label>
                <input
                  type="range"
                  min="1"
                  max="9"
                  value={compressionLevel}
                  onChange={(e) => setCompressionLevel(parseInt(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-xp-surface-light accent-xp-blue"
                />
                <div className="mt-1 flex justify-between text-[10px] text-xp-text-muted">
                  <span>{t('dialogs.compress.levelFastest')}</span>
                  <span>{t('dialogs.compress.levelBest')}</span>
                </div>
              </div>

              {/* Password Protection */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-xp-text">
                  {t('dialogs.compress.passwordLabel')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-xp-border/60 bg-xp-bg/60 w-full rounded-lg border px-3 py-1.5 text-xs text-xp-text focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue/40"
                  placeholder={t('dialogs.compress.passwordPlaceholder')}
                />
                <p className="mt-1 text-[10px] text-xp-text-muted">
                  {t('dialogs.compress.passwordNote')}
                </p>
              </div>

              {/* Options */}
              <div>
                <h4 className="mb-2 text-xs font-medium text-xp-text">
                  {t('dialogs.compress.options')}
                </h4>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={includeHidden}
                      onChange={(e) => setIncludeHidden(e.target.checked)}
                      className="h-3.5 w-3.5 accent-xp-blue"
                    />
                    <span className="text-xs text-xp-text">
                      {t('dialogs.compress.includeHidden')}
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={followSymlinks}
                      onChange={(e) => setFollowSymlinks(e.target.checked)}
                      className="h-3.5 w-3.5 accent-xp-blue"
                    />
                    <span className="text-xs text-xp-text">
                      {t('dialogs.compress.followSymlinks')}
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-xp-border/40 flex flex-shrink-0 justify-end space-x-2 border-t px-5 py-3">
          <button
            onClick={handleClose}
            disabled={compressing}
            className="border-xp-border/60 rounded-lg px-3.5 py-1.5 text-xs text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleCompress}
            disabled={compressing || loading || !outputPath.trim()}
            className="flex items-center space-x-2 rounded-lg bg-xp-blue px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-xp-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={
              compressing ? t('dialogs.compress.compressing') : t('dialogs.compress.compress')
            }
          >
            {compressing && (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border border-white/40 border-b-white" />
            )}
            <span>
              {compressing ? t('dialogs.compress.compressing') : t('dialogs.compress.compress')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompressDialog;
