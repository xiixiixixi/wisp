import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { FileEntry, FolderSizeInfo, FileTag, TauriAPI } from '@/lib/tauri-api';
import { primeFileTagsCache } from '@/lib/file-tags-cache';
import { syncFolderColorsFromTags } from '@/lib/folder-colors';
import { useDroppable } from '@/hooks/use-droppable';
import { useGridLayout } from '@/hooks/use-grid-layout';
import { useTypeAheadSearch } from '@/hooks/use-type-ahead-search';
import { useGridKeyboardNav } from '@/hooks/use-grid-keyboard-nav';
import { useFileTabStop } from '@/hooks/use-file-tab-stop';
import { useFileRevealScroll } from '@/hooks/use-file-reveal-scroll';
import { useThumbnailCache } from '@/hooks/use-thumbnail-cache';
import { ViewComponentProps } from './FileGridTypes';
import { isImageFile } from './FileGridHelpers';
import FileGridItem from './FileGridItem';
import TreeView from './TreeView';
import GalleryView from './GalleryView';
import DetailsView from './DetailsView';
import ColumnView from './ColumnView';
import { getFileGroupTranslationKey, type FileGroup } from '@/lib/utils';
import { FileGridSkeleton } from '@/components/ui/Skeleton';
import { FilePlus2, FolderOpen, FolderPlus } from 'lucide-react';
import {
  CROSS_TAB_SELECTION_EVENT,
  CROSS_TAB_SELECTION_CLEAR_EVENT,
  type CrossTabSelectionEventDetail,
  type CrossTabSelectionClearEventDetail,
} from '@/hooks/use-cross-tab-selection';

interface FileGridProps {
  files: FileEntry[];
  fileGroups?: FileGroup[] | null;
  isLoading: boolean;
  viewMode: string;
  selectedFiles: Set<string>;
  currentPath: string;
  groupId: string;
  getFileIcon: (file: FileEntry) => React.ReactNode;
  formatFileSize: (bytes: number) => string;
  formatFolderSize: (folderSizeInfo: FolderSizeInfo | null, isCalculating?: boolean) => string;
  formatDate: (timestamp: number) => string;
  handleFileClick: (file: FileEntry, event: React.MouseEvent, visibleFiles?: FileEntry[]) => void;
  handleFileDoubleClick: (file: FileEntry) => void;
  handleFileRightClick: (file: FileEntry, event: React.MouseEvent) => void;
  handleBackgroundRightClick?: (event: React.MouseEvent) => void;
  getFolderSize: (path: string) => FolderSizeInfo | null;
  isCalculatingSize: (path: string) => boolean;
  calculateFolderSize?: (path: string) => void;
  onQuickLook?: (file: FileEntry) => void;
  /** Whether to show color-coded file size badges */
  /** Set of file paths that are part of a cross-tab selection */
  crossTabSelectedPaths?: Set<string>;
  /** Called when an inline rename is confirmed. If not provided, inline rename is disabled. */
  onRenameFile?: (oldPath: string, newName: string) => Promise<boolean>;
  /** Externally controlled renaming path (set by F2 shortcut in parent) */
  renamingPath?: string | null;
  /** Setter to clear/set the renaming path from parent */
  setRenamingPath?: (path: string | null) => void;
  /** Empty-state action for creating a folder in the current directory. */
  onCreateFolder?: () => void;
  /** Empty-state action for creating a file in the current directory. */
  onCreateFile?: () => void;
}

const FileGrid = ({
  files,
  fileGroups,
  isLoading,
  viewMode,
  selectedFiles,
  currentPath,
  groupId,
  getFileIcon,
  formatFileSize,
  formatFolderSize,
  formatDate,
  handleFileClick: selectFile,
  handleFileDoubleClick,
  handleFileRightClick,
  handleBackgroundRightClick,
  getFolderSize,
  isCalculatingSize,
  calculateFolderSize,
  onQuickLook,
  crossTabSelectedPaths,
  onRenameFile,
  renamingPath: externalRenamingPath,
  setRenamingPath: externalSetRenamingPath,
  onCreateFolder,
  onCreateFile,
}: FileGridProps) => {
  const { t } = useTranslation();

  const needsVirtualization =
    files.length >= 200 && !['tree', 'gallery', 'details', 'column'].includes(viewMode);
  // Range selection must use the same order and filtering as the rendered
  // view. Tree/column/gallery ignore grouping; large grid/list views use their
  // ungrouped virtual list, while details keeps grouping at every size.
  const selectionFiles = useMemo(
    () =>
      !needsVirtualization &&
      !['tree', 'gallery', 'column'].includes(viewMode) &&
      fileGroups?.length
        ? fileGroups.flatMap((group) => group.files)
        : files,
    [files, fileGroups, needsVirtualization, viewMode],
  );
  const handleFileClick = useCallback(
    (file: FileEntry, event: React.MouseEvent, visibleFiles = selectionFiles) =>
      selectFile(file, event, visibleFiles),
    [selectFile, selectionFiles],
  );

  // ─── Git status for the current directory ───────────────────────────────────
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, string>>(new Map());
  // Cache paths confirmed as NOT a git repo (backend returned an error).
  // An empty status from the backend means "clean git repo", not "not a repo".
  const notGitRepoCache = useRef(new Set<string>());
  // Counter bumped by file-change events to trigger a git status re-fetch.
  const [gitRefetchCounter, setGitRefetchCounter] = useState(0);

  // Listen for file-change events so git status refreshes after staging/committing/editing
  useEffect(() => {
    const bump = () => setGitRefetchCounter((c) => c + 1);
    window.addEventListener('files-changed', bump);
    return () => {
      window.removeEventListener('files-changed', bump);
    };
  }, []);

  useEffect(() => {
    if (!currentPath || currentPath.startsWith('wisp://')) {
      setGitStatusMap(new Map());
      return;
    }

    // Check cache: if we know this path is NOT a git repo (backend error), skip IPC
    if (notGitRepoCache.current.has(currentPath)) {
      setGitStatusMap(new Map());
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const loadGitStatus = async () => {
        try {
          const statuses = await TauriAPI.getGitStatus(currentPath);
          if (!cancelled) {
            // A successful response (even empty) means this IS a git repo.
            // Empty = clean repo with no changed files.
            const map = new Map<string, string>();
            for (const s of statuses) {
              const normalized = s.path.replace(/\\/g, '/');
              map.set(normalized, s.status);
              map.set(s.path, s.status);
            }
            setGitStatusMap(map);
          }
        } catch {
          if (!cancelled) {
            // Backend returned an error -- this path is not inside a git repo
            notGitRepoCache.current.add(currentPath);
            setGitStatusMap(new Map());
          }
        }
      };

      loadGitStatus();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentPath, gitRefetchCounter]);

  // ─── Batch-load tags for all visible files ──────────────────────────────────
  const [allTags, setAllTags] = useState<Map<string, FileTag[]>>(new Map());

  // Use a stable key derived from file paths to avoid re-fetching on every render
  const filePathsKey = useMemo(() => files.map((f) => f.path).join('\n'), [files]);

  useEffect(() => {
    if (files.length === 0) return;

    // Only fetch tags on real filesystem paths (tag views included)
    if (
      (currentPath.startsWith('wisp://') && !currentPath.startsWith('wisp://tag/')) ||
      currentPath.startsWith('gdrive://')
    ) {
      return;
    }

    let cancelled = false;
    const loadAllTags = async () => {
      try {
        const paths = files.map((f) => f.path);
        const batchResult = await TauriAPI.getFileTagsBatch(paths);
        if (!cancelled) {
          const tagMap = new Map<string, FileTag[]>();
          for (const [path, tags] of Object.entries(batchResult)) {
            tagMap.set(path, tags);
          }
          setAllTags(tagMap);
          primeFileTagsCache(batchResult);
          syncFolderColorsFromTags(batchResult);
        }
      } catch {
        if (!cancelled) setAllTags(new Map());
      }
    };

    loadAllTags();
    const onTagsChanged = () => loadAllTags();
    window.addEventListener('file-tags-changed', onTagsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('file-tags-changed', onTagsChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePathsKey, currentPath]);

  // ─── Cross-tab selection state (Ctrl+Shift+Click toggles) ────────────────
  const [localCrossTabPaths, setLocalCrossTabPaths] = useState<Set<string>>(new Set());
  const localCrossTabScope = useRef({ groupId, currentPath });

  // Dispatch cross-tab selection event when the local set changes
  useEffect(() => {
    const sameScope =
      localCrossTabScope.current.groupId === groupId &&
      localCrossTabScope.current.currentPath === currentPath;
    const selectedEntries = sameScope ? files.filter((f) => localCrossTabPaths.has(f.path)) : [];
    const detail: CrossTabSelectionEventDetail = {
      tabId: groupId,
      tabPath: currentPath,
      files: selectedEntries,
    };
    window.dispatchEvent(new CustomEvent(CROSS_TAB_SELECTION_EVENT, { detail }));
  }, [localCrossTabPaths, files, groupId, currentPath]);

  // Keep the local marks and global basket in sync when cleared, navigated or closed.
  useEffect(() => {
    localCrossTabScope.current = { groupId, currentPath };
    setLocalCrossTabPaths((prev) => (prev.size === 0 ? prev : new Set()));
    const clearLocalSelection = (event: Event) => {
      const detail = (event as CustomEvent<CrossTabSelectionClearEventDetail>).detail;
      if (detail?.tabId && detail.tabId !== groupId) return;
      setLocalCrossTabPaths((prev) => (prev.size === 0 ? prev : new Set()));
    };
    window.addEventListener(CROSS_TAB_SELECTION_CLEAR_EVENT, clearLocalSelection);
    return () => {
      window.removeEventListener(CROSS_TAB_SELECTION_CLEAR_EVENT, clearLocalSelection);
      const detail: CrossTabSelectionEventDetail = {
        tabId: groupId,
        tabPath: currentPath,
        files: [],
      };
      window.dispatchEvent(new CustomEvent(CROSS_TAB_SELECTION_EVENT, { detail }));
    };
  }, [currentPath, groupId]);

  // Merge local + external cross-tab selections for visual indicator
  const mergedCrossTabPaths = useMemo(() => {
    const merged = new Set(localCrossTabPaths);
    if (crossTabSelectedPaths) {
      for (const p of crossTabSelectedPaths) merged.add(p);
    }
    return merged;
  }, [localCrossTabPaths, crossTabSelectedPaths]);

  // Stable callback refs for click handlers
  const onFileClick = useCallback(
    (file: FileEntry, event: React.MouseEvent) => {
      // Ctrl/Cmd+Shift+Click = toggle cross-tab selection
      if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        setLocalCrossTabPaths((prev) => {
          const next = new Set(prev);
          if (next.has(file.path)) {
            next.delete(file.path);
          } else {
            next.add(file.path);
          }
          return next;
        });
        return;
      }
      handleFileClick(file, event);
    },
    [handleFileClick],
  );
  const onFileDoubleClick = useCallback(
    (file: FileEntry) => handleFileDoubleClick(file),
    [handleFileDoubleClick],
  );
  const onFileRightClick = useCallback(
    (file: FileEntry, event: React.MouseEvent) => handleFileRightClick(file, event),
    [handleFileRightClick],
  );
  const emptyTags: FileTag[] = useMemo(() => [], []);

  // ─── Size percentiles for heatmap badges ─────────────────────────────────

  // ─── Thumbnail cache for image hover previews ───────────────────────────
  const { getThumbnailUrl, preloadThumbnails } = useThumbnailCache(100);

  // Preload thumbnails for visible image files
  useEffect(() => {
    const imagePaths = files
      .filter((file) => isImageFile(file) && file.is_cloud_placeholder !== true)
      .map((file) => file.path);
    if (imagePaths.length > 0) {
      preloadThumbnails(imagePaths.slice(0, 10)); // preload viewport-visible images only
    }
  }, [files, preloadThumbnails]);

  // ─── Inline rename state ─────────────────────────────────────────────────
  const [internalRenamingPath, internalSetRenamingPath] = useState<string | null>(null);
  // Caret offset carried from a label-click rename (Finder: caret lands
  // where the name was clicked). Null = select the base name (Enter/F2/Tab).
  const [renameCaretOffset, setRenameCaretOffset] = useState<number | null>(null);

  // Use external state when provided, otherwise fall back to internal state
  const renamingPath =
    externalRenamingPath !== undefined ? externalRenamingPath : internalRenamingPath;
  const setRenamingPath = useCallback(
    (path: string | null) => {
      if (externalSetRenamingPath) {
        externalSetRenamingPath(path);
      } else {
        internalSetRenamingPath(path);
      }
    },
    [externalSetRenamingPath],
  );
  const startRename = useCallback(
    (path: string, caretOffset: number | null) => {
      setRenameCaretOffset(caretOffset);
      setRenamingPath(path);
    },
    [setRenamingPath],
  );

  // Build list of existing file names for conflict detection
  const existingNames = useMemo(() => files.map((f) => f.name), [files]);

  // Clear rename mode when path changes or files are refreshed
  useEffect(() => {
    setRenamingPath(null);
  }, [currentPath, setRenamingPath]);

  // Listen for global inline-rename events (dispatched by the F2/Enter
  // shortcuts and by label clicks in the details/column/tree views)
  useEffect(() => {
    if (!onRenameFile) return;
    const handler = (e: Event) => {
      // A path can be visible in several split panes at once. Only the active
      // pane may handle a window-wide rename request, otherwise both editors
      // mount and one steals focus from (and cancels) the other. Use the pane
      // marker rather than document.activeElement: menu/toolbar commands can
      // intentionally start a rename while focus is outside the file list.
      const activePane = document.querySelector<HTMLElement>(
        '.wisp-editor-pane[data-active="true"]',
      );
      if (activePane && activePane.dataset.groupId !== groupId) return;
      const detail = (e as CustomEvent<{ path: string; caretOffset?: number }>).detail;
      if (detail?.path && files.some((f) => f.path === detail.path)) {
        startRename(detail.path, detail.caretOffset ?? null);
      }
    };
    window.addEventListener('start-inline-rename', handler);
    return () => window.removeEventListener('start-inline-rename', handler);
  }, [onRenameFile, files, groupId, startRename]);

  // Row click wrapper. Rename is started only by clicking the name label of
  // the already-selected item (see FileGridItem/useLabelRename) — the rest of
  // the row selects, never renames.
  const wrappedFileClick = useCallback(
    (file: FileEntry, event: React.MouseEvent) => {
      // If currently renaming, don't process clicks on other items
      if (renamingPath && renamingPath !== file.path) {
        // Clicking outside the renaming item cancels rename
        setRenamingPath(null);
        handleFileClick(file, event);
        return;
      }

      // If renaming this item, ignore click (let input handle it)
      if (renamingPath === file.path) return;

      onFileClick(file, event);
    },
    [renamingPath, setRenamingPath, handleFileClick, onFileClick],
  );

  const wrappedFileDoubleClick = useCallback(
    (file: FileEntry) => {
      if (renamingPath) return; // Suppress double-click while renaming
      onFileDoubleClick(file);
    },
    [renamingPath, onFileDoubleClick],
  );

  // Rename callbacks passed to FileGridItem
  const handleRenameConfirm = useCallback(
    async (oldPath: string, newName: string) => {
      setRenamingPath(null);
      if (onRenameFile) {
        await onRenameFile(oldPath, newName);
      }
    },
    [onRenameFile, setRenamingPath],
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, [setRenamingPath]);

  const handleRenameTab = useCallback(
    async (oldPath: string, newName: string | null, direction: 1 | -1) => {
      // Commit the rename (if the name changed), then hop to the neighbour —
      // wrapping at the ends — so a batch of files can be renamed with
      // consecutive Tab presses, Finder-style. Shift+Tab hops backwards.
      if (newName) {
        if (!onRenameFile) {
          setRenamingPath(null);
          return;
        }
        const success = await onRenameFile(oldPath, newName);
        if (!success) {
          setRenamingPath(null);
          return;
        }
      }
      const currentIndex = files.findIndex((f) => f.path === oldPath);
      if (currentIndex >= 0 && files.length > 0) {
        const nextIndex = (currentIndex + direction + files.length) % files.length;
        startRename(files[nextIndex].path, null);
        return;
      }
      setRenamingPath(null);
    },
    [onRenameFile, files, setRenamingPath, startRename],
  );

  // Finder: clicking the name label of the already-selected item starts a
  // rename with the caret where the label was clicked
  const handleRenameStart = useCallback(
    (file: FileEntry, caretOffset?: number) => {
      if (onRenameFile) startRename(file.path, caretOffset ?? null);
    },
    [onRenameFile, startRename],
  );

  // Background drop target — the whole grid accepts drops into currentPath
  const isSpecialPage = currentPath.startsWith('wisp://') || currentPath.startsWith('gdrive://');
  const bgDropRef = useDroppable(currentPath, isSpecialPage, true);

  // ─── Virtual scrolling hooks (must be called before any early returns) ───
  const parentRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);

  // ─── Grid layout helpers ──────────────────────────────────────────────────
  const {
    getColumnsCount,
    getEstimatedRowHeight,
    getGridLayout,
    getItemSize,
    listView,
    gridView,
    columns,
    gap,
  } = useGridLayout(viewMode, parentRef);

  const rowCount = Math.ceil(files.length / columns);
  const virtualizer = useVirtualizer({
    count: needsVirtualization ? rowCount : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => getEstimatedRowHeight(),
    overscan: 5,
    enabled: needsVirtualization,
  });

  // ─── Keyboard grid navigation + type-ahead search ─────────────────────────
  const { handleGridKeyDown: handleTypeAhead } = useTypeAheadSearch({
    files,
    viewMode,
    needsVirtualization,
    columns,
    virtualizer,
    getColumnsCount,
  });

  const keyboardFiles = selectionFiles;
  const virtualRows = virtualizer.getVirtualItems();
  const mountedFiles = needsVirtualization
    ? virtualRows.flatMap((row) => files.slice(row.index * columns, (row.index + 1) * columns))
    : keyboardFiles;
  const { tabStopPath, rememberFileFocus } = useFileTabStop(
    keyboardFiles,
    selectedFiles,
    mountedFiles,
  );

  useFileRevealScroll({
    groupId,
    currentPath,
    paths: keyboardFiles.map((file) => file.path),
    containerRef: keyboardRef,
    enabled: !isLoading && !['tree', 'gallery', 'details', 'column'].includes(viewMode),
    scrollToIndex: needsVirtualization
      ? (index) => virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' })
      : undefined,
  });

  const { handleKeyDown: handleGridNav } = useGridKeyboardNav({
    files: keyboardFiles,
    selectedFiles,
    columns,
    viewMode,
    getColumnsCount,
    handleFileClick,
    handleFileDoubleClick,
    needsVirtualization,
    virtualizer,
    onQuickLook,
    containerRef: keyboardRef,
  });

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // F2 / Enter rename is owned by the configurable shortcut system,
      // which dispatches 'start-inline-rename' — handled below at line ~321.
      // Escape during rename: cancel
      if (e.key === 'Escape' && renamingPath) {
        e.preventDefault();
        e.stopPropagation();
        setRenamingPath(null);
        return;
      }
      // While renaming, suppress grid navigation
      if (renamingPath) return;

      handleGridNav(e);
      // If the grid nav didn't consume it, try type-ahead
      if (!e.defaultPrevented) handleTypeAhead(e);
    },
    [handleGridNav, handleTypeAhead, renamingPath, setRenamingPath],
  );

  if (isLoading) {
    return <FileGridSkeleton viewMode={viewMode} />;
  }

  if (files.length === 0) {
    return (
      <div
        ref={bgDropRef}
        className="flex min-h-[320px] flex-1 items-center justify-center px-6 py-12"
        onContextMenu={handleBackgroundRightClick || undefined}
        role="region"
        aria-label={t('fileGrid.emptyFolder')}
      >
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-md border border-xp-border bg-xp-surface text-xp-blue shadow-lg">
            <FolderOpen size={26} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <p className="text-base font-semibold text-xp-text" aria-live="polite">
            {t('fileGrid.emptyFolder')}
          </p>
          <p className="mt-1.5 text-sm leading-5 text-xp-text-muted">
            {t('fileGrid.emptyFolderHint')}
          </p>
          {(onCreateFolder || onCreateFile) && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {onCreateFolder && (
                <button
                  type="button"
                  onClick={onCreateFolder}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-xp-blue px-3.5 text-sm font-semibold text-[var(--xp-bg)] transition-colors hover:bg-xp-blue-dark"
                >
                  <FolderPlus size={16} />
                  {t('operationBar.newFolder')}
                </button>
              )}
              {onCreateFile && (
                <button
                  type="button"
                  onClick={onCreateFile}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-xp-border bg-xp-surface px-3.5 text-sm font-semibold text-xp-text transition-colors hover:bg-xp-surface-light"
                >
                  <FilePlus2 size={16} />
                  {t('operationBar.newFile')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Delegate to specialized views ──────────────────────────────────────
  const viewComponentProps: ViewComponentProps = {
    tabStopPath,
    files,
    selectedFiles,
    currentPath,
    groupId,
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
    allTags,
    renamingPath,
    onRenameConfirm: handleRenameConfirm,
    onRenameCancel: handleRenameCancel,
    onRenameFile,
    onQuickLook,
  };

  if (viewMode === 'tree') {
    return <TreeView {...viewComponentProps} />;
  }

  if (viewMode === 'gallery') {
    return <GalleryView {...viewComponentProps} />;
  }

  if (viewMode === 'details') {
    return (
      <div
        ref={keyboardRef}
        className="wisp-file-selection-surface contents"
        onFocusCapture={rememberFileFocus}
        onKeyDown={handleGridKeyDown}
      >
        <DetailsView {...viewComponentProps} fileGroups={fileGroups} />
      </div>
    );
  }

  if (viewMode === 'column') {
    return <ColumnView {...viewComponentProps} />;
  }

  const itemSize = getItemSize();

  // Cross-tab selection visual indicator style
  const crossTabOutlineStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: 8,
    border: '2px solid var(--xp-selection-border)',
    opacity: 0.6,
    pointerEvents: 'none',
    zIndex: 6,
  };

  const crossTabBadgeStyle: React.CSSProperties = {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--xp-blue)',
    zIndex: 7,
    pointerEvents: 'none',
  };

  const renderFileItem = (file: FileEntry) => {
    const isCrossTabSelected = mergedCrossTabPaths.has(file.path);
    const isFileRenaming = renamingPath === file.path;
    return (
      <div key={file.path} style={{ position: 'relative', overflow: 'hidden', minWidth: 0 }}>
        {isCrossTabSelected && (
          <>
            <div style={crossTabOutlineStyle} />
            <div style={crossTabBadgeStyle} title={t('interface.selectedForCrossTabOperation')} />
          </>
        )}
        <FileGridItem
          tabStopPath={tabStopPath}
          file={file}
          isSelected={selectedFiles.has(file.path)}
          tags={allTags.get(file.path) || emptyTags}
          gitStatus={
            gitStatusMap.get(file.path) || gitStatusMap.get(file.path.replace(/\\/g, '/')) || null
          }
          isGridView={gridView}
          isListView={listView}
          viewMode={viewMode}
          itemSize={itemSize}
          selectedFiles={selectedFiles}
          allFiles={files}
          getFileIcon={getFileIcon}
          formatFileSize={formatFileSize}
          formatFolderSize={formatFolderSize}
          formatDate={formatDate}
          onQuickLook={onQuickLook}
          onFileClick={wrappedFileClick}
          onFileDoubleClick={wrappedFileDoubleClick}
          onFileRightClick={onFileRightClick}
          getFolderSize={getFolderSize}
          isCalculatingSize={isCalculatingSize}
          thumbnailUrl={
            isImageFile(file) && file.is_cloud_placeholder !== true
              ? getThumbnailUrl(file.path)
              : undefined
          }
          isRenaming={isFileRenaming}
          existingNames={isFileRenaming ? existingNames : undefined}
          initialRenameCaretOffset={isFileRenaming ? renameCaretOffset : undefined}
          onRenameConfirm={isFileRenaming ? handleRenameConfirm : undefined}
          onRenameCancel={isFileRenaming ? handleRenameCancel : undefined}
          onRenameTab={isFileRenaming ? handleRenameTab : undefined}
          onRenameStart={onRenameFile ? handleRenameStart : undefined}
        />
      </div>
    );
  };

  // For small file counts (< 200), skip virtualization for simplicity
  if (!needsVirtualization) {
    // Grouped rendering
    if (fileGroups && fileGroups.length > 0) {
      return (
        <div
          ref={(element) => {
            keyboardRef.current = element;
            bgDropRef.current = element;
          }}
          role="listbox"
          aria-label={t('explorer.details.fileListAria')}
          aria-multiselectable={true}
          className="wisp-file-selection-surface relative"
          onFocusCapture={rememberFileFocus}
          onContextMenu={handleBackgroundRightClick || undefined}
          onKeyDown={handleGridKeyDown}
        >
          {fileGroups.map((group) => (
            <div key={group.group}>
              <div className="sticky top-0 z-10 border-b border-xp-border bg-xp-surface px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-xp-text-muted">
                  {t(getFileGroupTranslationKey(group.group))}
                </span>
                <span className="ml-2 text-xs text-xp-text-muted">({group.files.length})</span>
              </div>
              <div className={`${getGridLayout()} p-2`}>{group.files.map(renderFileItem)}</div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div
        ref={(element) => {
          keyboardRef.current = element;
          bgDropRef.current = element;
        }}
        role="listbox"
        aria-label={t('explorer.details.fileListAria')}
        aria-multiselectable={true}
        className={`wisp-file-selection-surface ${getGridLayout()} relative p-2`}
        onFocusCapture={rememberFileFocus}
        onContextMenu={handleBackgroundRightClick || undefined}
        onKeyDown={handleGridKeyDown}
      >
        {files.map(renderFileItem)}
      </div>
    );
  }

  // Virtualized rendering for large directories
  return (
    <div
      ref={(el) => {
        keyboardRef.current = el;
        (parentRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        if (bgDropRef && 'current' in bgDropRef) {
          (bgDropRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }
      }}
      role="listbox"
      aria-label={t('explorer.details.fileListAria')}
      aria-multiselectable={true}
      tabIndex={tabStopPath ? -1 : 0}
      className="wisp-file-selection-surface relative h-full select-none overflow-auto"
      data-file-scroll-container
      onFocusCapture={rememberFileFocus}
      style={{ padding: '8px' }}
      onContextMenu={handleBackgroundRightClick || undefined}
      onKeyDown={handleGridKeyDown}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * columns;
          const rowFiles = files.slice(startIndex, startIndex + columns);

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
                display: listView ? 'block' : 'grid',
                gridTemplateColumns: listView ? undefined : `repeat(${columns}, 1fr)`,
                gap: listView ? undefined : `${gap}px`,
              }}
            >
              {rowFiles.map((file: FileEntry) => {
                const isFileRenaming = renamingPath === file.path;
                return (
                  <FileGridItem
                    tabStopPath={tabStopPath}
                    key={file.path}
                    file={file}
                    isSelected={selectedFiles.has(file.path)}
                    tags={allTags.get(file.path) || emptyTags}
                    gitStatus={
                      gitStatusMap.get(file.path) ||
                      gitStatusMap.get(file.path.replace(/\\/g, '/')) ||
                      null
                    }
                    isGridView={gridView}
                    isListView={listView}
                    viewMode={viewMode}
                    itemSize={itemSize}
                    selectedFiles={selectedFiles}
                    allFiles={files}
                    getFileIcon={getFileIcon}
                    formatFileSize={formatFileSize}
                    formatFolderSize={formatFolderSize}
                    formatDate={formatDate}
                    onQuickLook={onQuickLook}
                    onFileClick={wrappedFileClick}
                    onFileDoubleClick={wrappedFileDoubleClick}
                    onFileRightClick={onFileRightClick}
                    getFolderSize={getFolderSize}
                    isCalculatingSize={isCalculatingSize}
                    thumbnailUrl={
                      isImageFile(file) && file.is_cloud_placeholder !== true
                        ? getThumbnailUrl(file.path)
                        : undefined
                    }
                    isRenaming={isFileRenaming}
                    existingNames={isFileRenaming ? existingNames : undefined}
                    initialRenameCaretOffset={isFileRenaming ? renameCaretOffset : undefined}
                    onRenameConfirm={isFileRenaming ? handleRenameConfirm : undefined}
                    onRenameCancel={isFileRenaming ? handleRenameCancel : undefined}
                    onRenameTab={isFileRenaming ? handleRenameTab : undefined}
                    onRenameStart={onRenameFile ? handleRenameStart : undefined}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FileGrid;
