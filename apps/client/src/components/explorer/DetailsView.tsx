import React, { useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDraggable } from '@/hooks/use-draggable';
import { FileEntry, FolderSizeInfo } from '@/lib/tauri-api';
import { ViewComponentProps } from './FileGridTypes';
import { getDateGroupTranslationKey, type FileGroup } from '@/lib/utils';
import { FileReferenceBadge, getFileReferenceLabel } from './FileReferenceBadge';
import { InlineRenameInput } from './FileGridItem';
import { TagDots } from './FileGridHelpers';

// Kept inline (not from FileGridHelpers) so tests don't pull the real i18n singleton.
const isHiddenFile = (file: FileEntry): boolean => file.name.startsWith('.');

interface DetailsViewProps extends ViewComponentProps {
  fileGroups?: FileGroup[] | null;
}

const DETAILS_ROW_HEIGHT = 40;
const GROUP_HEADER_HEIGHT = 36;
const DETAILS_VIRTUALIZATION_THRESHOLD = 200;

type FlatItem =
  | { type: 'header'; group: { name: string; count: number } }
  | { type: 'file'; file: FileEntry };

interface FileRowProps {
  file: FileEntry;
  selectedFiles: Set<string>;
  allFiles: FileEntry[];
  getFileIcon: (file: FileEntry) => React.ReactNode;
  formatFileSize: (bytes: number) => string;
  formatFolderSize: (folderSizeInfo: FolderSizeInfo | null, isCalculating?: boolean) => string;
  formatDate: (timestamp: number) => string;
  onFileClick: (filePath: string, event: React.MouseEvent) => void;
  onFileDoubleClick: (filePath: string) => void;
  onFileRightClick: (filePath: string, event: React.MouseEvent) => void;
  getFolderSize: (path: string) => FolderSizeInfo | null;
  isCalculatingSize: (path: string) => boolean;
  onCalculateFolderSize?: (path: string) => void;
  tags?: import('@/lib/tauri-api').FileTag[];
  renamingPath?: string | null;
  onRenameConfirm?: (oldPath: string, newName: string) => void;
  onRenameCancel?: () => void;
  onRenameFile?: (oldPath: string, newName: string) => Promise<boolean>;
  onQuickLook?: (file: FileEntry) => void;
}

const FileRow = React.memo(
  ({
    file,
    selectedFiles,
    allFiles,
    getFileIcon,
    formatFileSize,
    formatFolderSize,
    formatDate,
    onFileClick,
    onFileDoubleClick,
    onFileRightClick,
    getFolderSize,
    isCalculatingSize,
    onCalculateFolderSize,
    tags,
    renamingPath,
    onRenameConfirm,
    onRenameCancel,
    onRenameFile,
    onQuickLook,
  }: FileRowProps) => {
    const { t } = useTranslation();
    const dragHandlers = useDraggable({ file, selectedFiles, allFiles });
    const handleClick = useCallback(
      (e: React.MouseEvent) => onFileClick(file.path, e),
      [onFileClick, file.path],
    );
    const handleDoubleClick = useCallback(
      () => onFileDoubleClick(file.path),
      [onFileDoubleClick, file.path],
    );
    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => onFileRightClick(file.path, e),
      [onFileRightClick, file.path],
    );
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        // Enter renames (Finder behaviour; open with ⌘O/⌘↓ via the shortcut system)
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent('start-inline-rename', { detail: { path: file.path } }),
          );
        }
        // Space previews (Finder behaviour). Consume the event so the
        // document-level shortcut system doesn't fire a second time.
        if (e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onQuickLook?.(file);
        }
      },
      [onQuickLook, file],
    );
    const handleCalculateClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onCalculateFolderSize?.(file.path);
      },
      [onCalculateFolderSize, file.path],
    );

    return (
      <div
        role="row"
        aria-selected={selectedFiles.has(file.path)}
        aria-label={
          getFileReferenceLabel(file, t)
            ? `${file.name}, ${getFileReferenceLabel(file, t)}`
            : file.name
        }
        tabIndex={0}
        data-file-path={file.path}
        data-drop-target={file.is_dir ? file.path : undefined}
        data-is-folder={file.is_dir ? 'true' : undefined}
        className={`grid cursor-pointer grid-cols-12 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-xp-surface-light ${
          selectedFiles.has(file.path) ? 'bg-xp-blue/30' : ''
        } text-xp-text`}
        {...(renamingPath === file.path ? {} : dragHandlers)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      >
        <div className="col-span-1 flex justify-center">
          <span className={`text-lg ${isHiddenFile(file) ? 'opacity-60' : ''}`}>
            <FileReferenceBadge file={file} compact>
              {getFileIcon(file)}
            </FileReferenceBadge>
          </span>
        </div>
        <div className="col-span-5 min-w-0">
          {renamingPath === file.path && onRenameFile ? (
            <InlineRenameInput
              fileName={file.name}
              isDir={file.is_dir}
              isListView
              existingNames={allFiles.map((f) => f.name)}
              filePath={file.path}
              onConfirm={(oldPath, newName) => {
                onRenameConfirm?.(oldPath, newName);
              }}
              onCancel={() => onRenameCancel?.()}
              onTab={(oldPath, newName) => {
                // Details rows have no Tab-hop flow of their own; commit only.
                if (newName) onRenameConfirm?.(oldPath, newName);
              }}
            />
          ) : (
            <div
              className={`flex min-w-0 items-center font-medium ${isHiddenFile(file) ? 'text-xp-text-muted' : ''}`}
            >
              <span className="min-w-0 truncate">{file.name}</span>
              <TagDots tags={tags ?? []} />
            </div>
          )}
        </div>
        <div className="col-span-2 text-right text-xs text-xp-text-muted">
          {(() => {
            if (!file.is_dir) return formatFileSize(file.size);
            if (getFolderSize(file.path) || isCalculatingSize(file.path)) {
              return formatFolderSize(getFolderSize(file.path), isCalculatingSize(file.path));
            }
            return (
              <button
                className="text-xp-text-muted underline decoration-dotted transition-colors hover:text-xp-accent"
                onClick={handleCalculateClick}
                title={t('explorer.details.calculateTitle')}
              >
                {t('explorer.details.calculate')}
              </button>
            );
          })()}
        </div>
        <div className="col-span-2 text-center text-xs text-xp-text-muted">
          <span className="text-xs capitalize">
            {file.is_dir ? t('common.folder') : file.file_type}
          </span>
        </div>
        <div className="col-span-2 text-right font-mono text-xs text-xp-text-muted">
          {formatDate(file.modified)}
        </div>
      </div>
    );
  },
);

const GroupHeader = React.memo(({ name, count }: { name: string; count: number }) => (
  <div
    className="border-xp-border/50 bg-xp-surface/60 flex items-center border-b px-3 py-2 backdrop-blur-sm"
    style={{ height: GROUP_HEADER_HEIGHT }}
  >
    <span className="text-xs font-semibold uppercase tracking-wide text-xp-text-secondary">
      {name}
    </span>
    <span className="ml-2 text-xs text-xp-text-muted">({count})</span>
  </div>
));

const DetailsView = (props: DetailsViewProps) => {
  const { t } = useTranslation();
  const {
    files,
    selectedFiles,
    getFileIcon,
    formatFileSize,
    formatFolderSize,
    formatDate,
    handleFileClick,
    handleFileDoubleClick,
    handleFileRightClick,
    handleBackgroundRightClick,
    getFolderSize,
    isCalculatingSize,
    calculateFolderSize,
    fileGroups,
    allTags,
    renamingPath,
    onRenameConfirm,
    onRenameCancel,
    onRenameFile,
    onQuickLook,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);

  const filesByPath = useMemo(() => {
    const map = new Map<string, FileEntry>();
    for (const file of files) {
      map.set(file.path, file);
    }
    if (fileGroups && fileGroups.length > 0) {
      for (const group of fileGroups) {
        for (const file of group.files) {
          map.set(file.path, file);
        }
      }
    }
    return map;
  }, [files, fileGroups]);

  const allFiles = useMemo(() => Array.from(filesByPath.values()), [filesByPath]);

  const onFileClick = useCallback(
    (filePath: string, event: React.MouseEvent) => {
      const file = filesByPath.get(filePath);
      if (file) handleFileClick(file, event);
    },
    [filesByPath, handleFileClick],
  );

  const onFileDoubleClick = useCallback(
    (filePath: string) => {
      const file = filesByPath.get(filePath);
      if (file) handleFileDoubleClick(file);
    },
    [filesByPath, handleFileDoubleClick],
  );

  const onFileRightClick = useCallback(
    (filePath: string, event: React.MouseEvent) => {
      const file = filesByPath.get(filePath);
      if (file) handleFileRightClick(file, event);
    },
    [filesByPath, handleFileRightClick],
  );

  const flatItems = useMemo<FlatItem[]>(() => {
    if (fileGroups && fileGroups.length > 0) {
      const items: FlatItem[] = [];
      for (const group of fileGroups) {
        items.push({
          type: 'header',
          group: { name: t(getDateGroupTranslationKey(group.group)), count: group.files.length },
        });
        for (const file of group.files) {
          items.push({ type: 'file', file });
        }
      }
      return items;
    }
    return files.map((file) => ({ type: 'file' as const, file }));
  }, [fileGroups, files, t]);

  const needsVirtualization = flatItems.length >= DETAILS_VIRTUALIZATION_THRESHOLD;

  const estimateSize = useCallback(
    (index: number) => {
      const item = flatItems[index];
      return item?.type === 'header' ? GROUP_HEADER_HEIGHT : DETAILS_ROW_HEIGHT;
    },
    [flatItems],
  );

  const virtualizer = useVirtualizer({
    count: needsVirtualization ? flatItems.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 10,
    enabled: needsVirtualization,
  });

  const header = (
    <div
      className="border-xp-border/60 bg-xp-surface/80 sticky top-0 z-20 border-b backdrop-blur-md"
      role="row"
    >
      <div className="grid grid-cols-12 items-center gap-3 px-3 py-3 text-xs font-medium text-xp-text-muted">
        <div
          className="col-span-1"
          role="columnheader"
          aria-label={t('explorer.details.iconCol')}
        />
        <div className="col-span-5" role="columnheader">
          {t('explorer.details.nameCol')}
        </div>
        <div className="col-span-2 text-right" role="columnheader">
          {t('explorer.details.sizeCol')}
        </div>
        <div className="col-span-2 text-center" role="columnheader">
          {t('explorer.details.typeCol')}
        </div>
        <div className="col-span-2 text-right" role="columnheader">
          {t('explorer.details.modifiedCol')}
        </div>
      </div>
    </div>
  );

  const stableRowProps = {
    selectedFiles,
    allFiles,
    getFileIcon,
    formatFileSize,
    formatFolderSize,
    formatDate,
    onFileClick,
    onFileDoubleClick,
    onFileRightClick,
    getFolderSize,
    isCalculatingSize,
    onCalculateFolderSize: calculateFolderSize,
    renamingPath,
    onRenameConfirm,
    onRenameCancel,
    onRenameFile,
    onQuickLook,
  };

  const renderFlatItem = (item: FlatItem) => {
    if (item.type === 'header') {
      return <GroupHeader name={item.group.name} count={item.group.count} />;
    }
    return (
      <FileRow file={item.file} {...stableRowProps} tags={allTags?.get(item.file.path) ?? []} />
    );
  };

  if (!needsVirtualization) {
    return (
      <div
        className="select-none text-sm"
        role="table"
        aria-label={t('explorer.details.fileListAria')}
        onContextMenu={handleBackgroundRightClick || undefined}
      >
        {header}
        <div className="divide-y divide-xp-border divide-opacity-30" role="rowgroup">
          {flatItems.map((item) => (
            <div key={item.type === 'header' ? `group-${item.group.name}` : item.file.path}>
              {renderFlatItem(item)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full select-none overflow-auto text-sm"
      role="table"
      aria-label={t('explorer.details.fileListAria')}
      onContextMenu={handleBackgroundRightClick || undefined}
    >
      {header}
      <div
        role="rowgroup"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = flatItems[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderFlatItem(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DetailsView;
