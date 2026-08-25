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
import { AlertTriangle, FolderOpen } from 'lucide-react';

interface CompressDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  files: FileEntry[];
}

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="max-h-[90vh] w-[600px] max-w-[90vw] overflow-hidden rounded-lg bg-xp-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border p-6">
          <h2 className="text-xl font-semibold text-xp-text">{t('dialogs.compress.title')}</h2>
          <button
            onClick={handleClose}
            disabled={compressing}
            className="rounded-md p-2 transition-colors hover:bg-xp-surface-light disabled:opacity-50"
            aria-label={t('common.close')}
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-6">
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-xp-blue" />
              <span className="ml-3 text-xp-text-muted">{t('dialogs.compress.analyzing')}</span>
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <div className="mb-4 text-4xl text-xp-red">
                <AlertTriangle size="1em" className="inline-block" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-xp-text">
                {t('dialogs.compress.errorAnalyzingTitle')}
              </h3>
              <p className="mb-4 text-xp-text-muted">{error}</p>
              <button
                onClick={loadCompressionInfo}
                className="rounded bg-xp-blue px-4 py-2 text-white transition-colors hover:bg-xp-blue-dark"
              >
                {t('dialogs.compress.tryAgain')}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Files Summary */}
              {compressionInfo && (
                <div className="rounded-lg bg-xp-bg p-4">
                  <h3 className="text-md mb-3 font-medium text-xp-text">
                    {t('dialogs.compress.filesToCompress')}
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-xp-text-muted">{t('dialogs.compress.files')}</span>
                      <span className="ml-2 text-xp-text">
                        {compressionInfo.total_files.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-xp-text-muted">
                        {t('dialogs.compress.directories')}
                      </span>
                      <span className="ml-2 text-xp-text">
                        {compressionInfo.total_directories.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-xp-text-muted">{t('dialogs.compress.totalSize')}</span>
                      <span className="ml-2 text-xp-text">
                        {formatFileSize(compressionInfo.total_size)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xp-text-muted">
                        {t('dialogs.compress.estimatedSize')}
                      </span>
                      <span className="ml-2 text-xp-text">
                        {formatFileSize(compressionInfo.estimated_compressed_size)}
                        <span className="ml-1 text-xs text-xp-green">({getSizeReduction()})</span>
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Output Path */}
              <div>
                <label className="mb-2 block text-sm font-medium text-xp-text">
                  {t('dialogs.compress.outputPath')}
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    className="flex-1 rounded-md border border-xp-border bg-xp-bg px-3 py-2 text-xp-text focus:border-xp-blue focus:ring-2 focus:ring-xp-blue"
                    placeholder={t('dialogs.compress.outputPathPlaceholder')}
                  />
                  <button
                    onClick={handleBrowseOutputPath}
                    className="rounded-md border border-xp-border px-3 py-2 transition-colors hover:bg-xp-surface-light"
                    aria-label={t('dialogs.compress.browseOutputDir')}
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>

              {/* Format Selection */}
              <div>
                <label className="mb-2 block text-sm font-medium text-xp-text">
                  {t('dialogs.compress.format')}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['Zip', 'TarGz', 'TarBz2', 'SevenZ'] as CompressionFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => handleFormatChange(fmt)}
                      className={`rounded-md border p-3 transition-colors ${
                        format === fmt
                          ? 'border-xp-blue bg-xp-blue bg-opacity-20 text-xp-blue'
                          : 'border-xp-border text-xp-text hover:bg-xp-surface-light'
                      }`}
                    >
                      <div className="font-medium">{fmt === 'SevenZ' ? '7z' : fmt}</div>
                      <div className="text-xs text-xp-text-muted">
                        .{getExtensionForFormat(fmt)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Compression Level */}
              <div>
                <label className="mb-2 block text-sm font-medium text-xp-text">
                  {t('dialogs.compress.level', { level: compressionLevel })}
                </label>
                <input
                  type="range"
                  min="1"
                  max="9"
                  value={compressionLevel}
                  onChange={(e) => setCompressionLevel(parseInt(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-xp-surface-light"
                />
                <div className="mt-1 flex justify-between text-xs text-xp-text-muted">
                  <span>{t('dialogs.compress.levelFastest')}</span>
                  <span>{t('dialogs.compress.levelBest')}</span>
                </div>
              </div>

              {/* Password Protection */}
              <div>
                <label className="mb-2 block text-sm font-medium text-xp-text">
                  {t('dialogs.compress.passwordLabel')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-xp-border bg-xp-bg px-3 py-2 text-xp-text focus:border-xp-blue focus:ring-2 focus:ring-xp-blue"
                  placeholder={t('dialogs.compress.passwordPlaceholder')}
                />
                <p className="mt-1 text-xs text-xp-text-muted">
                  {t('dialogs.compress.passwordNote')}
                </p>
              </div>

              {/* Options */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-xp-text">
                  {t('dialogs.compress.options')}
                </h4>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={includeHidden}
                      onChange={(e) => setIncludeHidden(e.target.checked)}
                      className="h-4 w-4 rounded border-xp-border bg-xp-bg text-xp-blue focus:ring-xp-blue"
                    />
                    <span className="text-sm text-xp-text">
                      {t('dialogs.compress.includeHidden')}
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={followSymlinks}
                      onChange={(e) => setFollowSymlinks(e.target.checked)}
                      className="h-4 w-4 rounded border-xp-border bg-xp-bg text-xp-blue focus:ring-xp-blue"
                    />
                    <span className="text-sm text-xp-text">
                      {t('dialogs.compress.followSymlinks')}
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 border-t border-xp-border bg-xp-bg p-6">
          <button
            onClick={handleClose}
            disabled={compressing}
            className="rounded px-4 py-2 text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleCompress}
            disabled={compressing || loading || !outputPath.trim()}
            className="flex items-center space-x-2 rounded bg-xp-blue px-4 py-2 text-white transition-colors hover:bg-xp-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={
              compressing ? t('dialogs.compress.compressing') : t('dialogs.compress.compress')
            }
          >
            {compressing && (
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
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
