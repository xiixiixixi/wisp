import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileEntry } from '@/lib/tauri-api';
import { useDraggable } from '@/hooks/use-draggable';
import { useDroppable } from '@/hooks/use-droppable';
import { useThumbnailCache } from '@/hooks/use-thumbnail-cache';
import { isImageFile } from './FileGridHelpers';
import { ViewComponentProps } from './FileGridTypes';
import { FileReferenceBadge } from './FileReferenceBadge';
import { formatDateTimeShort } from '@/lib/utils';

// Filmstrip thumbnail item
const GalleryStripThumb = React.memo(
  ({
    file,
    isFocused,
    isSelected,
    selectedFiles,
    allFiles,
    getFileIcon,
    thumbnailUrl,
    onClick,
    onDoubleClick,
    onRightClick,
  }: {
    file: FileEntry;
    isFocused: boolean;
    isSelected: boolean;
    selectedFiles: Set<string>;
    allFiles: FileEntry[];
    getFileIcon: (file: FileEntry) => React.ReactNode;
    thumbnailUrl?: string;
    onClick: (e: React.MouseEvent) => void;
    onDoubleClick: () => void;
    onRightClick: (e: React.MouseEvent) => void;
  }) => {
    const { t: tUi } = useTranslation();
    const [thumbError, setThumbError] = useState(false);
    const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
    const isImage = isImageFile(file);
    const dragHandlers = useDraggable({ file, selectedFiles, allFiles });
    const dropRef = useDroppable(file.path, !file.is_dir, file.is_dir);

    const dimensionOverlayStyle: React.CSSProperties = {
      position: 'absolute',
      bottom: 1,
      right: 1,
      fontSize: 7,
      lineHeight: 1,
      padding: '1px 3px',
      borderRadius: 3,
      background: 'rgba(0,0,0,0.6)',
      color: '#fff',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    };

    return (
      <div
        ref={dropRef}
        {...dragHandlers}
        role="option"
        aria-selected={isSelected}
        aria-label={tUi(file.is_dir ? 'messages.folderAria' : 'messages.fileAria', {
          name: file.name,
        })}
        data-gallery-path={file.path}
        className={`h-16 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded-[2px] border-2 transition-all ${(() => {
          if (isFocused) return 'scale-105 border-xp-blue ring-1 ring-xp-blue';
          if (isSelected) return 'border-xp-blue';
          return 'border-transparent hover:border-xp-text-muted';
        })()} `}
        style={{ position: 'relative' }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onRightClick}
        title={file.name}
      >
        {isImage && !thumbError && thumbnailUrl ? (
          <>
            <img
              src={thumbnailUrl}
              alt={file.name}
              className="h-full w-full object-cover"
              loading="lazy"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              onError={() => setThumbError(true)}
            />
            {dimensions && (
              <span style={dimensionOverlayStyle}>
                {dimensions.w}x{dimensions.h}
              </span>
            )}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-xp-surface-light">
            <span className="text-xl opacity-60">
              <FileReferenceBadge file={file}>{getFileIcon(file)}</FileReferenceBadge>
            </span>
          </div>
        )}
      </div>
    );
  },
);

GalleryStripThumb.displayName = 'GalleryStripThumb';

// Gallery View Component -- filmstrip style with large preview + thumbnail strip
const GalleryView = ({
  files,
  selectedFiles,
  currentPath,
  getFileIcon,
  formatFileSize,
  formatDate: _formatDate,
  handleFileClick,
  handleFileDoubleClick,
  handleFileRightClick,
  handleBackgroundRightClick,
}: ViewComponentProps) => {
  const [focusedFile, setFocusedFile] = useState<FileEntry | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewDimensions, setPreviewDimensions] = useState<{ w: number; h: number } | null>(null);
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);
  const { getThumbnailUrl, preloadThumbnails } = useThumbnailCache(100);

  // Filmstrip virtualizer — each thumbnail is 64px wide + 4px gap = 68px per item
  const THUMB_SIZE = 68;
  const filmstripVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => stripRef.current,
    estimateSize: () => THUMB_SIZE,
    horizontal: true,
    overscan: 5,
  });

  // Preload thumbnails for all image files in this folder
  useEffect(() => {
    const imagePaths = files.filter(isImageFile).map((f) => f.path);
    if (imagePaths.length > 0) preloadThumbnails(imagePaths);
  }, [files, preloadThumbnails]);
  const bgDropRef = useDroppable(
    currentPath,
    currentPath.startsWith('wisp://') || currentPath.startsWith('gdrive://'),
    true,
  );

  // Reset focused file when files change (navigated to a new folder)
  useEffect(() => {
    setFocusedFile(null);
    setPreviewError(false);
  }, [currentPath]);

  // Auto-focus: use selected file, or first file
  const displayFile =
    focusedFile ?? files.find((f) => selectedFiles.has(f.path)) ?? files[0] ?? null;
  const isDisplayImage = displayFile ? isImageFile(displayFile) : false;

  // Reset the preview when the displayed file changes
  useEffect(() => {
    setPreviewError(false);
    setPreviewDimensions(null);

    if (!displayFile || !isImageFile(displayFile)) return;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayFile?.path]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!displayFile) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const idx = files.indexOf(displayFile);
      if (idx === -1) return;

      if (e.key === 'ArrowRight' && idx < files.length - 1) {
        e.preventDefault();
        const next = files[idx + 1];
        setFocusedFile(next);
        const syntheticEvent = {
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          button: 0,
        } as React.MouseEvent;
        handleFileClick(next, syntheticEvent);
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        const prev = files[idx - 1];
        setFocusedFile(prev);
        const syntheticEvent = {
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          button: 0,
        } as React.MouseEvent;
        handleFileClick(prev, syntheticEvent);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [files, displayFile, handleFileClick]);

  // Scroll the active thumbnail into view via virtualizer
  useEffect(() => {
    if (!displayFile) return;
    const idx = files.indexOf(displayFile);
    if (idx !== -1) {
      filmstripVirtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' });
    }
  }, [displayFile, files, filmstripVirtualizer]);

  return (
    <div
      ref={bgDropRef}
      className="flex h-full select-none flex-col overflow-hidden"
      aria-label={t('interface.galleryView')}
      onContextMenu={handleBackgroundRightClick || undefined}
    >
      {/* -- Large preview area -- */}
      <div
        className="bg-xp-bg/50 relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        aria-label={
          displayFile ? `Preview of ${displayFile.name}` : t('panels.properties.noFileSelected')
        }
        onDoubleClick={() => displayFile && handleFileDoubleClick(displayFile)}
        onContextMenu={(e) => displayFile && handleFileRightClick(displayFile, e)}
      >
        {(() => {
          if (!displayFile) {
            return <div className="text-sm text-xp-text-muted">{t('interface.noFiles')}</div>;
          }
          if (isDisplayImage && !previewError) {
            return (
              <>
                <img
                  src={getThumbnailUrl(displayFile.path)}
                  alt={displayFile.name}
                  className="max-h-full max-w-full select-none object-contain"
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setPreviewDimensions({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                  onError={() => setPreviewError(true)}
                />
                {/* Image dimensions overlay */}
                {previewDimensions && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: 'rgba(0,0,0,0.55)',
                      color: '#fff',
                      pointerEvents: 'none',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {previewDimensions.w} x {previewDimensions.h}
                  </div>
                )}
              </>
            );
          }
          return (
            <div className="flex flex-col items-center gap-2.5 text-xp-text-secondary">
              <span className="text-[110px] leading-none opacity-80">
                <FileReferenceBadge file={displayFile}>
                  {getFileIcon(displayFile)}
                </FileReferenceBadge>
              </span>
              <span className="text-base font-medium">{displayFile.name}</span>
              <span className="text-sm">
                {displayFile.is_dir ? t('common.folder') : formatFileSize(displayFile.size)}
              </span>
            </div>
          );
        })()}

        {/* File info overlay */}
        {displayFile && (
          <div className="gallery-info-bar absolute bottom-0 left-0 right-0 px-4 py-2">
            <div className="truncate text-sm font-medium text-xp-on-accent">{displayFile.name}</div>
            <div className="text-xp-on-accent/70 text-xs">
              {displayFile.is_dir ? t('common.folder') : formatFileSize(displayFile.size)}
              {displayFile.modified > 0 && (
                <> &middot; {formatDateTimeShort(displayFile.modified)}</>
              )}
            </div>
          </div>
        )}
      </div>

      {/* -- Horizontal filmstrip (virtualized) -- */}
      <div className="flex-shrink-0 border-t border-xp-border bg-xp-surface">
        <div
          ref={stripRef}
          className="gallery-filmstrip overflow-x-auto p-2"
          style={{ position: 'relative', height: '56px' }}
        >
          <div
            style={{
              width: `${filmstripVirtualizer.getTotalSize()}px`,
              height: '100%',
              position: 'relative',
            }}
          >
            {filmstripVirtualizer.getVirtualItems().map((virtualItem) => {
              const file = files[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${virtualItem.size - 4}px`,
                    height: '48px',
                    transform: `translateX(${virtualItem.start}px)`,
                  }}
                >
                  <GalleryStripThumb
                    file={file}
                    isFocused={displayFile?.path === file.path}
                    isSelected={selectedFiles.has(file.path)}
                    selectedFiles={selectedFiles}
                    allFiles={files}
                    getFileIcon={getFileIcon}
                    thumbnailUrl={isImageFile(file) ? getThumbnailUrl(file.path) : undefined}
                    onClick={(e) => {
                      setFocusedFile(file);
                      handleFileClick(file, e);
                    }}
                    onDoubleClick={() => handleFileDoubleClick(file)}
                    onRightClick={(e) => handleFileRightClick(file, e)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GalleryView;
