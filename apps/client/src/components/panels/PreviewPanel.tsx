import i18n from '@/i18n';
import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import { FileEntry, TauriAPI, FolderSizeInfo } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { getFileIcon } from '@/lib/utils';
import { defaultPreviewFactory, PreviewProps, PreviewType } from '@/lib/preview-factory';
import { extensionHost } from '@/lib/extension-host';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { FileText } from 'lucide-react';
import PreviewUnavailable, {
  type PreviewUnavailableReason,
} from '@/components/previews/PreviewUnavailable';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useTranslation } from 'react-i18next';

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
  onShowDetails: () => void;
}> = ({ file, category, currentPath, onShowDetails }) => {
  const [PreviewComponent, setPreviewComponent] =
    useState<React.ComponentType<PreviewProps> | null>(null);
  const [extensionPreviewElement, setExtensionPreviewElement] = useState<React.ReactElement | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [unavailableReason, setUnavailableReason] = useState<PreviewUnavailableReason | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadPreviewComponent = async () => {
      try {
        setLoading(true);
        setUnavailableReason(null);
        setPreviewComponent(null);
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
          if (category !== 'unknown') {
            if (!cancelled) setUnavailableReason('too-large');
            return;
          }
          // Finder previews ANY text file regardless of extension (Makefile,
          // .gitignore, extensionless scripts, …) — sniff the content and
          // route it to the text preview when the leading bytes are UTF-8.
          if (isTauri() && file.size > 0 && file.size <= 10 * 1024 * 1024) {
            let isText = false;
            try {
              isText = await TauriAPI.previewSniffText(file.path);
            } catch (error) {
              if (!cancelled) {
                console.error('Could not read file for preview:', error);
                setUnavailableReason('failed');
              }
              return;
            }
            if (cancelled) return;
            if (isText) {
              const TextComponent = await import('@/components/previews/TextPreview').then(
                (m) => m.default,
              );
              if (!cancelled) {
                previewComponentCache.set('text', TextComponent);
                setPreviewComponent(() => TextComponent);
                setLoading(false);
              }
              return;
            }
          }
          if (!cancelled) {
            setUnavailableReason('unsupported');
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
          } else {
            setUnavailableReason('failed');
          }
          setPreviewComponent(() => component);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load preview component:', err);
          setUnavailableReason('failed');
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
  }, [file.path, file.name, category, currentPath, attempt]);

  const handlePreviewError = useCallback((error: Error) => {
    console.error('Preview error:', error);
    setUnavailableReason('failed');
  }, []);

  const handlePreviewLoad = useCallback(() => setUnavailableReason(null), []);

  const retry = () => {
    previewComponentCache.delete(category);
    setLoading(true);
    setAttempt((value) => value + 1);
  };

  if (loading) {
    return <PreviewSkeleton />;
  }

  if (unavailableReason) {
    return (
      <PreviewUnavailable
        file={file}
        reason={unavailableReason}
        onShowDetails={onShowDetails}
        onRetry={retry}
      />
    );
  }

  // An extension can be valid even when no built-in renderer was loaded.
  if (!extensionPreviewElement && !PreviewComponent) {
    return <PreviewUnavailable file={file} reason="unsupported" onShowDetails={onShowDetails} />;
  }

  return (
    <ErrorBoundary
      key={attempt}
      fallback={
        <PreviewUnavailable
          file={file}
          reason="failed"
          onShowDetails={onShowDetails}
          onRetry={retry}
        />
      }
    >
      {extensionPreviewElement ||
        (PreviewComponent && (
          <PreviewComponent file={file} onError={handlePreviewError} onLoad={handlePreviewLoad} />
        ))}
    </ErrorBoundary>
  );
};

// Finder-style folder preview: large folder icon + item count + size.
const FolderDetails: React.FC<{
  file: FileEntry;
  getFolderSize?: (path: string) => FolderSizeInfo | null;
  isCalculatingSize?: (path: string) => boolean;
  formatFileSize: (bytes: number) => string;
}> = ({ file, getFolderSize, isCalculatingSize, formatFileSize }) => {
  const { t: tUi } = useTranslation();
  const folderSize = getFolderSize?.(file.path);
  const calculating = isCalculatingSize?.(file.path) || false;
  const itemCount = folderSize ? folderSize.file_count + folderSize.dir_count : null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="wisp-preview-file-icon wisp-preview-folder-icon" aria-hidden="true">
        {getFileIcon(file)}
      </div>
      <div>
        <p className="max-w-[240px] truncate text-sm font-semibold text-xp-text" title={file.name}>
          {file.name}
        </p>
        <p className="mt-0.5 text-xs text-xp-text-secondary">
          {itemCount !== null ? (
            <>
              {tUi('previewPanel.folderItems', { count: itemCount })}
              {folderSize && folderSize.total_size > 0 && (
                <> · {formatFileSize(folderSize.total_size)}</>
              )}
            </>
          ) : calculating ? (
            tUi('interface.calculatingSize')
          ) : (
            tUi('commandPalette.folderType')
          )}
        </p>
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
  const { t: tUi } = useTranslation();
  const propertiesId = useId();
  const propertiesToggleRef = useRef<HTMLButtonElement>(null);
  const [showProperties, setShowProperties] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealProperties = useCallback(() => {
    setShowProperties(true);
    propertiesToggleRef.current?.focus();
  }, []);

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
        className="wisp-preview-empty flex h-full items-center justify-center text-center text-xp-text-secondary"
        role="region"
        aria-label={i18n.t('previewPanel.noFileSelectedAria')}
      >
        <div className="wisp-preview-empty-content">
          <div className="wisp-preview-empty-visual" aria-hidden="true">
            <FileText size={40} strokeWidth={1.25} />
          </div>
          <h4>{i18n.t('previewPanel.selectFileToPreview')}</h4>
          <p>{i18n.t('previewPanel.emptyDescription')}</p>
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
        className="wisp-preview-content min-h-0 flex-1 overflow-auto"
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
                  key={previewFile.path}
                  file={previewFile}
                  category={category}
                  currentPath={currentPath}
                  onShowDetails={revealProperties}
                />
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* Quick Actions Bar */}

      {/* Collapsible File Properties Section */}
      <div className="wisp-preview-properties">
        {/* Properties Header - Always visible */}
        <button
          ref={propertiesToggleRef}
          type="button"
          onClick={() => setShowProperties(!showProperties)}
          className="wisp-preview-properties-toggle flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-xp-surface-light"
          aria-expanded={showProperties}
          aria-controls={propertiesId}
          aria-label={
            showProperties
              ? tUi('previewPanel.hideProperties', { defaultValue: 'Hide file properties' })
              : tUi('previewPanel.showProperties', { defaultValue: 'Show file properties' })
          }
        >
          <div className="flex min-w-0 items-center">
            <div className="mr-2 shrink-0 text-lg">{getFileIcon(selectedFile)}</div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold" title={selectedFile.name}>
                {selectedFile.name}
              </h3>
              <p className="text-xs text-xp-text-secondary">
                {selectedFile.is_dir
                  ? tUi('commandPalette.folderType')
                  : formatFileSize(selectedFile.size)}
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
        <div id={propertiesId} className="px-3 pb-3" hidden={!showProperties}>
          {showProperties && (
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-xp-text-muted">{tUi('interface.typeLabel')}</span>
                <span className="font-semibold text-xp-text">
                  {selectedFile.is_dir ? tUi('commandPalette.folderType') : tUi('fileType.File')}
                </span>
              </div>

              {!selectedFile.is_dir && (
                <div className="flex justify-between">
                  <span className="text-xp-text-muted">{tUi('interface.sizeLabel')}</span>
                  <span className="font-semibold tabular-nums text-xp-text">
                    {formatFileSize(selectedFile.size)}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-xp-text-muted">{tUi('interface.modifiedLabel')}</span>
                <span className="font-semibold tabular-nums text-xp-text">
                  {formatDate(selectedFile.modified)}
                </span>
              </div>

              {selectedFile.mime_type && (
                <div className="flex justify-between">
                  <span className="text-xp-text-muted">{tUi('interface.mimeTypeLabel')}</span>
                  <span className="break-all text-right text-xp-text">
                    {selectedFile.mime_type}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-xp-text-muted">{tUi('interface.categoryLabel')}</span>
                <span className="font-semibold capitalize text-xp-text">{category}</span>
              </div>

              <div className="space-y-1 pt-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-xp-text-muted">{tUi('interface.pathLabel')}</span>
                  <button
                    onClick={handleCopyPath}
                    className={`rounded-md border px-2.5 py-0.5 text-[11px] transition-colors ${
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
                <div className="border-xp-border/40 bg-xp-bg/60 break-all rounded-md border p-2 font-mono text-[11px] leading-relaxed text-xp-text-secondary">
                  {selectedFile.path}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewPanel;
