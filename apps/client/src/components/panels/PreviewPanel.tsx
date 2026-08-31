import i18n from '@/i18n';
import React, { useState, useEffect, useRef } from 'react';
import { FileEntry, TauriAPI, FolderSizeInfo } from '@/lib/tauri-api';
import { getFileIcon } from '@/lib/utils';
import { defaultPreviewFactory, PreviewProps, PreviewType } from '@/lib/preview-factory';
import { extensionHost } from '@/lib/extension-host';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import PreviewActionBar from './PreviewActionBar';

// Module-level cache for preview components by file type, avoiding redundant dynamic imports
const previewComponentCache = new Map<PreviewType, React.ComponentType<PreviewProps>>();

/** Delay in ms before committing a file selection for preview loading. */
const PREVIEW_DEBOUNCE_MS = 200;

interface PreviewPanelProps {
  selectedFile: FileEntry | null;
  formatFileSize: (bytes: number) => string;
  formatDate: (timestamp: number) => string;
  getFolderSize?: (path: string) => FolderSizeInfo | null;
  isCalculatingSize?: (path: string) => boolean;
  currentPath?: string;
}

// Enhanced file preview component using the preview factory
const EnhancedFilePreview: React.FC<{
  file: FileEntry;
  category: PreviewType;
  currentPath?: string;
}> = ({ file, category: _category, currentPath }) => {
  const [PreviewComponent, setPreviewComponent] =
    useState<React.ComponentType<PreviewProps> | null>(null);
  const [extensionPreviewElement, setExtensionPreviewElement] = useState<React.ReactElement | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPreviewComponent = async () => {
      try {
        setLoading(true);
        setError(null);
        setExtensionPreviewElement(null);

        // Check extension previews first (extension > built-in > fallback)
        const extPreview = extensionHost.queryPreview({
          name: file.name,
          path: file.path,
          is_dir: file.is_dir,
          size: file.size,
        });

        if (extPreview) {
          // Try to load text content for text-like files
          let fileContent: string | null = null;
          const textExts = [
            'txt',
            'log',
            'ini',
            'cfg',
            'conf',
            'md',
            'json',
            'csv',
            'xml',
            'yaml',
            'yml',
            'toml',
            'js',
            'ts',
            'jsx',
            'tsx',
            'py',
            'java',
            'cpp',
            'c',
            'cs',
            'php',
            'rb',
            'go',
            'rs',
            'html',
            'css',
            'scss',
          ];
          const ext = file.name.split('.').pop()?.toLowerCase() || '';
          if (textExts.includes(ext) && file.size < 2 * 1024 * 1024) {
            try {
              fileContent = await TauriAPI.readTextFile(file.path);
            } catch {
              // Not a text file or read failed; pass null
            }
          }

          if (!cancelled) {
            const element = extPreview.render({
              filePath: file.path,
              fileContent,
              currentPath,
              selectedFiles: [
                { name: file.name, path: file.path, is_dir: file.is_dir, size: file.size },
              ],
            });
            setExtensionPreviewElement(element);
            setLoading(false);
          }
          return;
        }

        // Fall back to built-in preview factory
        if (!defaultPreviewFactory.canPreview(file)) {
          if (!cancelled) {
            setPreviewComponent(null);
            setLoading(false);
          }
          return;
        }

        const fileType = defaultPreviewFactory.getFileType(file);

        // Check module-level cache first to avoid redundant dynamic imports
        const cached = previewComponentCache.get(fileType);
        if (cached) {
          if (!cancelled) {
            setPreviewComponent(() => cached);
            setLoading(false);
          }
          return;
        }

        const component = await defaultPreviewFactory.getPreviewComponent(file);
        if (!cancelled) {
          if (component) {
            previewComponentCache.set(fileType, component);
          }
          setPreviewComponent(() => component);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load preview component:', err);
          setError(err instanceof Error ? err.message : i18n.t('previewPanel.failedLoad'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPreviewComponent();
    return () => {
      cancelled = true;
    };
    // file.path and file.name are sufficient to determine preview type
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, file.name, currentPath]);

  const handlePreviewError = (error: Error) => {
    console.error('Preview error:', error);
    setError(error.message);
  };

  const handlePreviewLoad = () => {
    setError(null);
  };

  if (loading) {
    return <PreviewSkeleton />;
  }

  if (error) {
    return (
      <div className="mt-4">
        <h4 className="mb-2 text-xs font-semibold text-xp-text">Preview Error</h4>
        <div
          className="rounded border border-xp-border bg-xp-surface p-4 text-center text-xp-text-secondary"
          role="alert"
        >
          <svg
            className="mx-auto mb-2 h-8 w-8"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-xs">Preview failed</p>
          <p className="mt-1 text-xs opacity-70">{error}</p>
        </div>
      </div>
    );
  }

  // Extension preview takes priority over built-in previews
  if (extensionPreviewElement) {
    return extensionPreviewElement;
  }

  if (PreviewComponent) {
    return <PreviewComponent file={file} onError={handlePreviewError} onLoad={handlePreviewLoad} />;
  }

  // Fallback for unsupported file types
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-4 text-4xl">{getFileIcon(file)}</div>
        <p className="mb-2 text-sm text-xp-text-secondary">No preview available</p>
        <p className="text-xs text-xp-text-secondary">
          {file.size > 50 * 1024 * 1024
            ? i18n.t('previewPanel.tooLarge')
            : i18n.t('previewPanel.notSupported')}
        </p>
        <p className="mt-1 text-xs text-xp-text-secondary">Double-click to open</p>
      </div>
    </div>
  );
};

// Folder details component
const FolderDetails: React.FC<{
  file: FileEntry;
  getFolderSize?: (path: string) => FolderSizeInfo | null;
  isCalculatingSize?: (path: string) => boolean;
  formatFileSize: (bytes: number) => string;
}> = ({ file, getFolderSize, isCalculatingSize, formatFileSize }) => {
  const folderSize = getFolderSize?.(file.path);
  const calculating = isCalculatingSize?.(file.path) || false;

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="max-w-sm rounded border border-xp-border bg-xp-surface p-6 text-center">
        <div className="mb-4 text-4xl">{getFileIcon(file)}</div>
        <h4 className="mb-4 text-sm font-medium text-xp-text">Folder Contents</h4>
        <div className="space-y-3 text-sm">
          {folderSize && (
            <>
              <div className="flex justify-between">
                <span className="text-xp-text-secondary">Total Size:</span>
                <span>{formatFileSize(folderSize.total_size)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xp-text-secondary">Files:</span>
                <span>{folderSize.file_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xp-text-secondary">Folders:</span>
                <span>{folderSize.dir_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xp-text-secondary">Total Items:</span>
                <span>{folderSize.file_count + folderSize.dir_count}</span>
              </div>
            </>
          )}
          {calculating && (
            <div className="py-2 text-center">
              <div className="inline-flex items-center text-xp-text-secondary">
                <svg className="-ml-1 mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Calculating size...
              </div>
            </div>
          )}
          {!folderSize && !calculating && (
            <div className="py-2 text-center text-xs text-xp-text-secondary">
              Click to calculate folder size
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PreviewPanel = ({
  selectedFile,
  formatFileSize,
  formatDate,
  getFolderSize,
  isCalculatingSize,
  currentPath,
}: PreviewPanelProps) => {
  const [showProperties, setShowProperties] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up copy feedback timer on unmount
  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  // Lazy preview: debounce the selected file so quick navigation skips heavy loads
  const [confirmedFile, setConfirmedFile] = useState<FileEntry | null>(selectedFile);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending timer when selectedFile changes
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // If the file is cleared, confirm immediately (no delay for deselection)
    if (!selectedFile) {
      setConfirmedFile(null);
      return;
    }

    // If the confirmed file is already the same path, no need to debounce
    if (confirmedFile && confirmedFile.path === selectedFile.path) {
      return;
    }

    // Start a debounce timer; only confirm the file after PREVIEW_DEBOUNCE_MS
    debounceTimerRef.current = setTimeout(() => {
      setConfirmedFile(selectedFile);
      debounceTimerRef.current = null;
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
    // Debounce only on path change; confirmedFile check is a guard inside the effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile?.path]);

  // Whether we are in the debounce waiting period (selected != confirmed)
  const isDebouncing =
    selectedFile !== null && (confirmedFile === null || confirmedFile.path !== selectedFile.path);

  const handleCopyPath = async () => {
    if (selectedFile) {
      try {
        await navigator.clipboard.writeText(selectedFile.path);
        setCopyFeedback(true);
        if (copyFeedbackTimerRef.current) {
          clearTimeout(copyFeedbackTimerRef.current);
        }
        copyFeedbackTimerRef.current = setTimeout(() => {
          setCopyFeedback(false);
          copyFeedbackTimerRef.current = null;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy path:', err);
      }
    }
  };

  if (!selectedFile) {
    return (
      <div
        className="flex h-full items-center justify-center text-center text-xp-text-secondary"
        role="region"
        aria-label="No file selected for preview"
      >
        <div>
          <svg
            className="mx-auto mb-3 h-12 w-12"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
              clipRule="evenodd"
            />
          </svg>
          <p>Select a file to preview</p>
        </div>
      </div>
    );
  }

  // Use selectedFile for the properties section (always instant), but
  // confirmedFile for the heavy preview content area (debounced).
  const previewFile = isDebouncing ? null : confirmedFile;
  const category = defaultPreviewFactory.getFileType(selectedFile);

  return (
    <div
      className="flex h-full flex-col"
      role="region"
      aria-label={`Preview of ${selectedFile.name}`}
    >
      {/* Main Preview Area - Takes most of the space */}
      <div
        className="min-h-0 flex-1 overflow-auto"
        aria-label={`${selectedFile.is_dir ? i18n.t('common.folder') : i18n.t('common.file')} preview: ${selectedFile.name}`}
      >
        {(() => {
          if (isDebouncing) return <PreviewSkeleton />;
          if (previewFile && previewFile.is_dir) {
            return (
              <div className="flex h-full items-center justify-center">
                <FolderDetails
                  file={previewFile}
                  getFolderSize={getFolderSize}
                  isCalculatingSize={isCalculatingSize}
                  formatFileSize={formatFileSize}
                />
              </div>
            );
          }
          if (previewFile) {
            return (
              <div className="h-full">
                <EnhancedFilePreview
                  file={previewFile}
                  category={category}
                  currentPath={currentPath}
                />
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* Quick Actions Bar */}
      <PreviewActionBar file={selectedFile} />

      {/* Collapsible File Properties Section */}
      <div className="border-t border-xp-border bg-xp-surface">
        {/* Properties Header - Always visible */}
        <button
          onClick={() => setShowProperties(!showProperties)}
          className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-xp-surface-light"
          aria-expanded={showProperties}
          aria-label={`${showProperties ? 'Hide' : 'Show'} file properties`}
        >
          <div className="flex items-center">
            <div className="mr-2 text-lg">{getFileIcon(selectedFile)}</div>
            <div>
              <h3 className="truncate text-sm font-medium" title={selectedFile.name}>
                {selectedFile.name}
              </h3>
              <p className="text-xs text-xp-text-secondary">
                {selectedFile.is_dir ? 'Folder' : formatFileSize(selectedFile.size)}
              </p>
            </div>
          </div>
          <svg
            className={`h-4 w-4 transition-transform ${showProperties ? 'rotate-180' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Properties Content - Collapsible */}
        {showProperties && (
          <div className="px-3 pb-3">
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-xp-text-muted">Type:</span>
                <span className="font-medium text-xp-text">
                  {selectedFile.is_dir ? 'Folder' : 'File'}
                </span>
              </div>

              {!selectedFile.is_dir && (
                <div className="flex justify-between">
                  <span className="text-xp-text-muted">Size:</span>
                  <span className="font-medium tabular-nums text-xp-text">
                    {formatFileSize(selectedFile.size)}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-xp-text-muted">Modified:</span>
                <span className="font-medium tabular-nums text-xp-text">
                  {formatDate(selectedFile.modified)}
                </span>
              </div>

              {selectedFile.mime_type && (
                <div className="flex justify-between">
                  <span className="text-xp-text-muted">MIME Type:</span>
                  <span className="break-all text-right text-xp-text">
                    {selectedFile.mime_type}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-xp-text-muted">Category:</span>
                <span className="font-medium capitalize text-xp-text">{category}</span>
              </div>

              <div className="space-y-1 pt-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-xp-text-muted">Path:</span>
                  <button
                    onClick={handleCopyPath}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      copyFeedback
                        ? 'border-xp-green/40 bg-xp-green/10 text-xp-green'
                        : 'border-xp-border/60 bg-xp-surface-light/60 text-xp-text-secondary hover:text-xp-text'
                    }`}
                    title={i18n.t('previewPanel.copyPath')}
                    aria-label={
                      copyFeedback
                        ? i18n.t('previewPanel.pathCopied')
                        : i18n.t('previewPanel.copyFilePath')
                    }
                  >
                    {copyFeedback ? i18n.t('previewPanel.copied') : i18n.t('common.copy')}
                  </button>
                </div>
                <div className="border-xp-border/40 bg-xp-bg/60 break-all rounded-lg border p-2 font-mono text-[11px] leading-relaxed text-xp-text-secondary">
                  {selectedFile.path}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PreviewPanel;
