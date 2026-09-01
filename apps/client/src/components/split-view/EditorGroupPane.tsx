import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { sortFiles, groupFilesByDate, type FileGroup, type SortField } from '@/lib/utils';
import { useFolderSizes } from '@/hooks/use-folder-sizes';
import { useHiddenFiles } from '@/hooks/use-hidden-files';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { useCollectionFiles } from '@/hooks/use-collection-files';
import WebTabView from '@/components/web/WebTabView';
import type { EditorGroup } from '@/types/split-view';
import { extensionHost } from '@/lib/extension-host';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import PaneTabBar from './PaneTabBar';
import NavigationBar from '@/components/explorer/NavigationBar';
import {
  type PaneSyncMode,
  type PaneSyncNavigateDetail,
  emitPaneSyncNavigate,
  computeRelativeSyncPath,
} from '@/hooks/use-pane-sync';
import { useFolderViewSettings } from '@/hooks/use-folder-view-settings';
import { getDemoDirectory, isBrowserDemoMode } from '@/lib/browser-demo-files';
import { ancestorPaths } from '@/lib/path-ancestry';

// Re-export components needed by the pane content
import HomePage from '@/pages/HomePage';
import TrashPage from '@/components/TrashPage';
import FileComparisonPage from '@/pages/FileComparisonPage';
import PaneFileExplorer from './PaneFileExplorer';

const ChatFileView = React.lazy(() => import('@/pages/ChatFileView'));
const FileEditorView = React.lazy(() => import('@/pages/FileEditorView'));

export interface SharedPaneActions {
  // File operations
  handleFileOpen: (file: FileEntry) => void;
  handleFileRightClick: (file: FileEntry, event: React.MouseEvent, groupId: string) => void;
  handleBackgroundRightClick: (event: React.MouseEvent, groupId: string) => void;
  handleDelete: (files: FileEntry[]) => void;
  handleCreateFolder: (currentPath: string) => void;
  handleCreateFile: (currentPath: string) => void;
  handleCompress: (files: FileEntry[]) => void;
  handleExtract: (file: FileEntry) => void;
  handleProperties: (file: FileEntry) => void;

  // Theme
  theme: string;
  setTheme: (theme: string) => void;

  // Bottom panel controls
  setBottomPanelCollapsed: (collapsed: boolean) => void;
  setBottomPanelTab: (tab: string) => void;

  // Navigation from home
  onNavigateFromHome: (path: string, groupId: string) => void;

  // GDrive
  onGDriveNavigate?: (
    accountId: string,
    folderId: string,
    folderName: string,
    groupId: string,
  ) => void;
  onGDriveFileSelect?: (file: FileEntry) => void;

  // Toast
  onError: (title: string, description: string) => void;

  // Advanced selection
  onSelectAll: (files: FileEntry[]) => void;
  onAdvancedSelection: () => void;

  // Quick Look
  onQuickLook?: (file: FileEntry) => void;

  // Inline rename
  renameFileInline?: (oldPath: string, newName: string) => Promise<boolean>;

  // Files change callback: active pane pushes its files + refetch to parent
  onFilesChange?: (files: FileEntry[], refetch: () => void) => void;

  // Navigation (for address bar in each pane)
  navigateBackInHistory?: () => void;
  navigateForwardInHistory?: () => void;
  canNavigateBackInHistory?: () => boolean;
  canNavigateForwardInHistory?: () => boolean;
  navigateUp?: () => void;
  navigateToPath?: (path: string) => void;
  refetchFiles?: () => void;
}

interface EditorGroupPaneProps {
  group: EditorGroup;
  isActive: boolean;
  canClose: boolean;
  totalGroups: number;
  sharedActions: SharedPaneActions;
  /** Shared selection state from parent -- the pane is a controlled component. */
  selectedFiles: Set<string>;
  setSelectedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Shared single-file selection from parent (for preview). */
  selectedFile: FileEntry | null;
  setSelectedFile: React.Dispatch<React.SetStateAction<FileEntry | null>>;
  /** Controlled view/sort state from parent. */
  viewMode: string;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;
  sortBy: SortField;
  setSortBy: React.Dispatch<React.SetStateAction<SortField>>;
  sortOrder: 'asc' | 'desc';
  setSortOrder: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>;
  // Split layout actions
  onSwitchTab: (groupId: string, tabId: string) => void;
  onCloseTab: (groupId: string, tabId: string) => void;
  onAddTab: (groupId: string) => void;
  onSplitHorizontal: (groupId: string) => void;
  onSplitVertical: (groupId: string) => void;
  onCloseGroup: (groupId: string) => void;
  onSetActiveGroup: (groupId: string) => void;
  onNavigate: (groupId: string, path: string, name: string) => void;
  // Group-scoped history navigation (per-pane ‹ ›)
  onNavigateBackHistory?: (groupId: string) => void;
  onNavigateForwardHistory?: (groupId: string) => void;
  // Tab management actions
  onTogglePin?: (groupId: string, tabId: string) => void;
  onDuplicateTab?: (groupId: string, tabId: string) => void;
  onCloseOtherTabs?: (groupId: string, tabId: string) => void;
  onCloseTabsToRight?: (groupId: string, tabId: string) => void;
  onCloseAllTabs?: (groupId: string) => void;
  onReorderTab?: (groupId: string, fromIndex: number, toIndex: number) => void;
  // Maximize/restore
  isMaximized?: boolean;
  onMaximizePane?: (groupId: string) => void;
  onRestorePane?: () => void;
  // Pane sync navigation
  paneSyncEnabled?: boolean;
  paneSyncMode?: PaneSyncMode;
  onTogglePaneSync?: () => void;
  onSwitchPaneSyncMode?: (mode: PaneSyncMode) => void;
}

const EditorGroupPane = ({
  group,
  isActive,
  canClose,
  totalGroups,
  sharedActions,
  selectedFiles,
  setSelectedFiles,
  selectedFile: _selectedFile,
  setSelectedFile,
  viewMode,
  setViewMode: _setViewMode,
  sortBy: _sortBy,
  setSortBy: _setSortBy,
  sortOrder: _sortOrder,
  setSortOrder: _setSortOrder,
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onSplitHorizontal,
  onSplitVertical,
  onCloseGroup,
  onSetActiveGroup,
  onNavigate,
  onNavigateBackHistory,
  onNavigateForwardHistory,
  onTogglePin,
  onDuplicateTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseAllTabs,
  onReorderTab,
  isMaximized,
  onMaximizePane,
  onRestorePane,
  paneSyncEnabled,
  paneSyncMode,
  onTogglePaneSync,
  onSwitchPaneSyncMode,
}: EditorGroupPaneProps) => {
  const {
    theme,
    setTheme,
    setBottomPanelCollapsed,
    setBottomPanelTab,
    onNavigateFromHome,
    handleFileOpen,
    handleFileRightClick,
    handleBackgroundRightClick,
    handleDelete,
    handleCreateFolder,
    handleCreateFile,
    handleCompress,
    handleExtract,
    handleProperties,
    onGDriveNavigate: _onGDriveNavigate,
    onGDriveFileSelect: _onGDriveFileSelect,
    onError,
    onAdvancedSelection,
    onQuickLook,
    renameFileInline,
  } = sharedActions;

  const activeTab = group.tabs.find((t) => t.id === group.activeTabId);
  const { currentPath } = group;

  // Per-pane, per-folder view & sort settings (persisted in localStorage)
  const folderSettings = useFolderViewSettings(currentPath, viewMode);
  const localViewMode = folderSettings.viewMode;
  const localSetViewMode = folderSettings.setViewMode;
  const localSortBy = folderSettings.sortBy;
  const localSetSortBy = folderSettings.setSortBy;
  const localSortOrder = folderSettings.sortOrder;
  const _localSetSortOrder = folderSettings.setSortOrder;
  const { groupByDate, setGroupByDate, toggleSortOrder } = folderSettings;

  // Detect collection paths
  const isCollectionPath = currentPath.startsWith('collection://');
  const collectionId = isCollectionPath ? currentPath.replace('collection://', '') : null;
  // Web tabs render a live page in a native child webview — no fs querying.
  const isWebPath = /^https?:\/\//i.test(currentPath);

  // Stable empty array to avoid creating a new [] reference on every render
  // when useQuery returns undefined (query disabled or data not yet loaded).
  const EMPTY_FILES = useRef<FileEntry[]>([]).current;

  // Path-scoped query: panes showing the same folder share one read/cache.
  const {
    data: queryFilesRaw,
    isLoading: queryLoading,
    refetch: queryRefetch,
  } = useQuery<FileEntry[]>({
    queryKey: ['files', currentPath],
    queryFn: async () => {
      if (currentPath.startsWith('wisp://tag/')) {
        // Finder's sidebar tag click: every file carrying the tag. Must
        // come before the demo branch — the demo resolves these paths
        // through its own in-memory tag store inside findFilesByTag.
        const tagName = decodeURIComponent(currentPath.slice('wisp://tag/'.length));
        return await TauriAPI.findFilesByTag(tagName);
      }
      if (isBrowserDemoMode()) {
        return getDemoDirectory(currentPath) ?? [];
      }
      if (currentPath.startsWith('gdrive://')) {
        const match = currentPath.match(/^gdrive:\/\/([^/]+)\/(.*)$/);
        if (match) {
          const [, accountId, folderId] = match;
          return await TauriAPI.gdriveListFiles(accountId, folderId || 'root');
        }
        return [];
      }
      if (currentPath.startsWith('ssh://')) {
        return await TauriAPI.sshReadDirectory(currentPath);
      }
      try {
        return await TauriAPI.readDirectory(currentPath);
      } catch (err) {
        if (String(err).includes('does not exist')) {
          // The folder was deleted out from under this pane. Returning an
          // empty listing drops the stale contents immediately; the ancestor
          // navigation above moves the pane to a surviving folder.
          void navigateToSurvivingAncestor();
          return [];
        }
        throw err;
      }
    },
    // A short freshness window makes back/forward and split-pane navigation
    // instant without hiding external changes for long. Watchers and explicit
    // file-operation events still refetch immediately.
    staleTime: 5_000,
    enabled:
      activeTab?.type !== 'editor' &&
      currentPath !== 'wisp://home' &&
      currentPath !== 'wisp://trash' &&
      currentPath !== 'wisp://gdrive-manager' &&
      !isWebPath &&
      !currentPath.startsWith('comparison://') &&
      (!currentPath.startsWith('wisp://') || currentPath.startsWith('wisp://tag/')) &&
      !isCollectionPath,
  });
  const queryFiles = queryFilesRaw ?? EMPTY_FILES;

  // Fallback base path for collection scanning (memoized to avoid re-renders)
  const collectionFallbackPath = useMemo(() => {
    // collectionId triggers re-read of localStorage when collection changes
    void collectionId;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.UI_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.lastRealPath) return parsed.lastRealPath as string;
      }
    } catch {
      /* ignore localStorage/parse errors */
    }
    return '';
  }, [collectionId]);

  // Collection files hook (only active when on a collection:// path)
  const collectionResult = useCollectionFiles(collectionId, collectionFallbackPath);

  // Merge: pick the right file source based on the current path
  const files = isCollectionPath ? collectionResult.files : queryFiles;
  const isLoading = isCollectionPath ? collectionResult.isLoading : queryLoading;
  const refetch = isCollectionPath ? collectionResult.refetch : queryRefetch;

  // When the current folder disappears (deleted externally), land on the
  // nearest ancestor that still exists — Finder's behaviour — falling back
  // to Home if the whole chain is gone (e.g. unmounted volume). The exists
  // re-check first also covers delete-then-recreate races (build tooling
  // doing rm -rf + mkdir): if the folder is already back, just refresh.
  const navigateToSurvivingAncestor = useCallback(async () => {
    try {
      if (await TauriAPI.isDir(currentPath)) {
        void refetch();
        return;
      }
    } catch {
      /* fall through to the ancestor walk */
    }
    for (const ancestor of ancestorPaths(currentPath)) {
      try {
        if (await TauriAPI.isDir(ancestor)) {
          const sep = ancestor.includes('\\') ? '\\' : '/';
          onNavigate(group.id, ancestor, ancestor.split(sep).pop() || ancestor);
          return;
        }
      } catch {
        /* keep climbing */
      }
    }
    onNavigate(group.id, 'wisp://home', 'Home');
  }, [currentPath, group.id, onNavigate, refetch]);

  // Push files + refetch up to parent when this pane is active.
  // Guard: only push when the files array reference actually changes to avoid
  // infinite re-render loops (parent setState → re-render → effect fires → repeat).
  const onFilesChangeRef = useRef(sharedActions.onFilesChange);
  onFilesChangeRef.current = sharedActions.onFilesChange;
  const prevPushedFilesRef = useRef<FileEntry[]>(EMPTY_FILES);
  const prevPushedRefetchRef = useRef<() => void>(refetch);
  useEffect(() => {
    if (!isActive) return;
    if (files === prevPushedFilesRef.current && refetch === prevPushedRefetchRef.current) return;
    prevPushedFilesRef.current = files;
    prevPushedRefetchRef.current = refetch;
    onFilesChangeRef.current?.(files, refetch);
  }, [files, isActive, refetch]);

  const { getFolderSize, isCalculatingSize, calculateFolderSize, calculateMissingSizes } =
    useFolderSizes(files);

  // Auto-calculate folder sizes if the setting is enabled
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (saved) {
        const settings = JSON.parse(saved);
        if (settings.autoCalculateFolderSizes && files.some((f) => f.is_dir)) {
          calculateMissingSizes();
        }
      }
    } catch {
      /* ignore localStorage/parse errors */
    }
  }, [files, calculateMissingSizes]);

  // Listen for files-changed events (from drag-drop operations) to refetch
  useEffect(() => {
    const onFilesChanged = () => {
      // Each pane refreshes only its own path. Invalidating every file query
      // from every mounted pane multiplied the same request in split view.
      void refetch();
    };
    window.addEventListener('files-changed', onFilesChanged);
    return () => window.removeEventListener('files-changed', onFilesChanged);
  }, [refetch]);

  // ── Live folder watcher ───────────────────────────────────────────────────
  // Every pane watches its own folder (not just the active one) so external
  // changes — editor saves, agent CLI writes, deletions — refresh the listing,
  // and a deleted current folder navigates to a surviving ancestor instead of
  // showing stale contents.
  const isRealDirPath =
    activeTab?.type !== 'editor' &&
    !currentPath.startsWith('wisp://') &&
    !currentPath.startsWith('gdrive://') &&
    !currentPath.startsWith('ssh://') &&
    !currentPath.startsWith('comparison://') &&
    !currentPath.startsWith('collection://') &&
    !isBrowserDemoMode();
  const navigateToSurvivingAncestorRef = useRef(navigateToSurvivingAncestor);
  navigateToSurvivingAncestorRef.current = navigateToSurvivingAncestor;
  useEffect(() => {
    if (!isRealDirPath) return;
    let disposed = false;
    let watcherId: string | null = null;
    let unlisten: (() => void) | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefetch = () => {
      // Trailing debounce: always re-read after the last event settles, so a
      // burst of writes can never leave the listing half-applied.
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void refetch();
      }, 400);
    };

    (async () => {
      try {
        // Listen before watching so no event can slip through the gap between
        // registering the watcher and registering the listener.
        unlisten = await TauriAPI.listenToEvent<{
          watcher_id: string;
          path: string;
          event_type: string;
        }>('fs-change', (event) => {
          if (!watcherId || event.watcher_id !== watcherId) return;
          if (event.event_type === 'file-deleted' && event.path === currentPath) {
            void navigateToSurvivingAncestorRef.current();
            return;
          }
          scheduleRefetch();
        });
        if (disposed) return;
        watcherId = await TauriAPI.watchDirectory(currentPath, false);
      } catch (err) {
        console.warn('[pane] Failed to watch directory:', err);
      }
    })();

    return () => {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unlisten?.();
      if (watcherId) {
        TauriAPI.unwatchDirectory(watcherId).catch(() => undefined);
      }
    };
  }, [isRealDirPath, currentPath, refetch]);

  // Per-pane "go up a level" for the navigation bar next to the breadcrumbs —
  // scoped to THIS pane's path, not the active group's.
  const paneAncestors = useMemo(
    () => (isRealDirPath ? ancestorPaths(currentPath) : []),
    [isRealDirPath, currentPath],
  );
  const canNavigateUp = paneAncestors.length > 0;
  const handlePaneNavigateUp = useCallback(() => {
    const parent = paneAncestors[0];
    if (!parent) return;
    const sep = parent.includes('\\') ? '\\' : '/';
    onNavigate(group.id, parent, parent.split(sep).pop() || parent);
  }, [paneAncestors, group.id, onNavigate]);

  // Sort files using per-folder settings
  const sortedFilesRaw = useMemo(
    () => sortFiles(files, localSortBy, localSortOrder),
    [files, localSortBy, localSortOrder],
  );

  // Honor the global ⇧⌘. hidden-file visibility in split panes too
  const { showHiddenFiles } = useHiddenFiles();
  const sortedFiles = useMemo(
    () =>
      showHiddenFiles ? sortedFilesRaw : sortedFilesRaw.filter((f) => !f.name.startsWith('.')),
    [sortedFilesRaw, showHiddenFiles],
  );

  const selectedEntries = useMemo(
    () => sortedFiles.filter((file) => selectedFiles.has(file.path)),
    [selectedFiles, sortedFiles],
  );
  const singleSelectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const selectedEntryIsArchive = Boolean(
    singleSelectedEntry && /\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(singleSelectedEntry.name),
  );

  // Grouped files (only computed when grouping is active)
  const fileGroups: FileGroup[] | null = useMemo(
    () => (groupByDate ? groupFilesByDate(sortedFiles) : null),
    [groupByDate, sortedFiles],
  );

  // Clear selection when this pane navigates to a new path
  React.useEffect(() => {
    if (!isActive) return;
    setSelectedFiles(new Set());
    setSelectedFile(null);
  }, [currentPath, isActive, setSelectedFiles, setSelectedFile]);

  // Track last-clicked index for shift-click range selection
  const lastClickedIndexRef = useRef<number>(-1);
  const sortedFilesRef = useRef(sortedFiles);
  sortedFilesRef.current = sortedFiles;

  // File click handler (per-pane) — uses parent's setSelectedFile directly
  const handleFileClick = useCallback(
    (file: FileEntry, event?: React.MouseEvent) => {
      setSelectedFile(file);

      const currentFiles = sortedFilesRef.current;
      const clickedIndex = currentFiles.findIndex((f) => f.path === file.path);

      if (event && event.shiftKey && lastClickedIndexRef.current >= 0) {
        // Shift+click: select range from last clicked to current
        const start = Math.min(lastClickedIndexRef.current, clickedIndex);
        const end = Math.max(lastClickedIndexRef.current, clickedIndex);
        const rangePaths = currentFiles.slice(start, end + 1).map((f) => f.path);

        if (event.ctrlKey || event.metaKey) {
          // Shift+Ctrl: add range to existing selection
          setSelectedFiles((prev) => {
            const next = new Set(prev);
            for (const p of rangePaths) next.add(p);

            return next;
          });
        } else {
          // Shift only: replace selection with range
          const newSet = new Set(rangePaths);
          setSelectedFiles(newSet);
        }
        return;
      }

      if (event && (event.ctrlKey || event.metaKey)) {
        // Ctrl+click: toggle individual file
        lastClickedIndexRef.current = clickedIndex;
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          if (next.has(file.path)) next.delete(file.path);
          else next.add(file.path);

          return next;
        });
        return;
      }

      // Normal click: select single file
      lastClickedIndexRef.current = clickedIndex;
      const newSet = new Set([file.path]);
      setSelectedFiles(newSet);
    },
    [setSelectedFiles, setSelectedFile],
  );

  // File double click (per-pane)
  const handleFileDoubleClick = useCallback(
    async (file: FileEntry) => {
      TauriAPI.addRecentFile(file.path).catch(() => {
        /* fire-and-forget */
      });
      if (!file.is_dir) {
        handleFileOpen(file);
      } else {
        onNavigate(group.id, file.path, file.name);
      }
    },
    [group.id, onNavigate, handleFileOpen],
  );

  // File right-click adapter
  const onFileRightClick = useCallback(
    (file: FileEntry, event: React.MouseEvent) => {
      handleFileRightClick(file, event, group.id);
    },
    [group.id, handleFileRightClick],
  );

  // Background right-click adapter
  const onBgRightClick = useCallback(
    (event: React.MouseEvent) => {
      handleBackgroundRightClick(event, group.id);
    },
    [group.id, handleBackgroundRightClick],
  );

  // ── Pane sync navigation ─────────────────────────────────────────────────

  // Guard flag: set to true while this pane is reacting to a sync event, so
  // the resulting navigation does NOT re-emit another sync event (prevents
  // infinite ping-pong loops).
  const syncGuardRef = useRef(false);

  // Track the previous path so we can compute relative navigations.
  const prevPathRef2 = useRef(currentPath);
  useEffect(() => {
    prevPathRef2.current = currentPath;
  }, [currentPath]);

  // Emit sync event whenever this pane navigates AND sync is enabled AND
  // the navigation was NOT triggered by an incoming sync event.
  const prevSyncEmitPathRef = useRef(currentPath);
  useEffect(() => {
    if (!paneSyncEnabled) return;
    if (syncGuardRef.current) {
      // This navigation was triggered by an incoming sync event — do not
      // re-emit.  Reset the guard so subsequent user-initiated navigations
      // will emit normally.
      syncGuardRef.current = false;
      prevSyncEmitPathRef.current = currentPath;
      return;
    }
    if (currentPath === prevSyncEmitPathRef.current) return;

    const previousPath = prevSyncEmitPathRef.current;
    prevSyncEmitPathRef.current = currentPath;

    // Don't sync special protocol paths
    if (currentPath.startsWith('wisp://') || currentPath.startsWith('comparison://')) return;

    emitPaneSyncNavigate({
      sourceGroupId: group.id,
      path: currentPath,
      previousPath,
      mode: paneSyncMode ?? 'mirror',
    });
  }, [currentPath, paneSyncEnabled, paneSyncMode, group.id]);

  // Listen for sync events from other panes.
  useEffect(() => {
    if (!paneSyncEnabled) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PaneSyncNavigateDetail>).detail;
      // Ignore events emitted by this pane.
      if (detail.sourceGroupId === group.id) return;
      // Don't react to special protocol paths.
      if (detail.path.startsWith('wisp://') || detail.path.startsWith('comparison://')) return;

      let targetPath: string | null;

      if (detail.mode === 'mirror') {
        targetPath = detail.path;
      } else {
        // Relative mode: compute where this pane should go.
        targetPath = computeRelativeSyncPath(detail.previousPath, detail.path, currentPath);
      }

      if (targetPath && targetPath !== currentPath) {
        // Set guard so the resulting navigation does NOT re-emit a sync event.
        syncGuardRef.current = true;
        onNavigate(group.id, targetPath, targetPath.split(/[/\\]/).pop() || targetPath);
      }
    };

    window.addEventListener('pane-sync-navigate', handler);
    return () => window.removeEventListener('pane-sync-navigate', handler);
  }, [paneSyncEnabled, paneSyncMode, group.id, currentPath, onNavigate]);

  // Render content based on current path / tab type
  const renderContent = () => {
    if (currentPath === 'wisp://home') {
      return (
        <div className="flex-1 overflow-auto">
          <HomePage
            onNavigate={(path: string) => onNavigateFromHome(path, group.id)}
            theme={theme}
            setTheme={setTheme}
          />
        </div>
      );
    }

    if (currentPath === 'wisp://trash') {
      return (
        <div className="flex-1 overflow-auto">
          <TrashPage onClose={() => onNavigate(group.id, 'wisp://home', 'Home')} />
        </div>
      );
    }

    if (activeTab?.type === 'web' && activeTab.path && /^https?:\/\//i.test(activeTab.path)) {
      return <WebTabView tabId={activeTab.id} url={activeTab.path} />;
    }

    if (
      activeTab?.type === 'gdrive-manager' ||
      (activeTab?.type === 'gdrive' && activeTab.gdriveData)
    ) {
      return (
        <div className="flex flex-1 items-center justify-center overflow-auto text-sm text-xp-text-muted">
          Install the Google Drive extension
        </div>
      );
    }

    if (activeTab?.type === 'comparison' && activeTab.comparisonData) {
      return (
        <FileComparisonPage
          file1Path={activeTab.comparisonData.file1Path}
          file2Path={activeTab.comparisonData.file2Path}
          onError={(error: string) => onError('Comparison Error', error)}
        />
      );
    }

    // Chat file view
    if (activeTab?.path?.endsWith('.chat')) {
      return (
        <div className="flex-1 overflow-auto">
          <React.Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xp-text-muted">
                Loading chat...
              </div>
            }
          >
            <ChatFileView filePath={activeTab.path} />
          </React.Suspense>
        </div>
      );
    }

    // Editor tab (text/code files) — check extension editors first, fallback to built-in
    if (activeTab?.type === 'editor' && activeTab.path) {
      const extEditor = extensionHost.getEditorForFile(activeTab.path);
      if (extEditor) {
        return (
          <div className="flex flex-1 flex-col overflow-hidden">
            {extEditor.render({ filePath: activeTab.path })}
          </div>
        );
      }
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <React.Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xp-text-muted">
                Loading editor...
              </div>
            }
          >
            <FileEditorView filePath={activeTab.path} />
          </React.Suspense>
        </div>
      );
    }

    // Default: file explorer
    return (
      <PaneFileExplorer
        viewMode={localViewMode}
        setViewMode={localSetViewMode}
        sortBy={localSortBy}
        setSortBy={localSetSortBy}
        sortOrder={localSortOrder}
        toggleSortOrder={toggleSortOrder}
        groupByDate={groupByDate}
        setGroupByDate={setGroupByDate}
        sortedFiles={sortedFiles}
        fileGroups={fileGroups}
        isLoading={isLoading}
        selectedFiles={selectedFiles}
        setSelectedFiles={setSelectedFiles}
        currentPath={currentPath}
        groupId={group.id}
        handleCreateFolder={() => handleCreateFolder(currentPath)}
        handleDelete={() =>
          handleDelete(sortedFiles.filter((file) => selectedFiles.has(file.path)))
        }
        handleFileClick={handleFileClick}
        handleFileDoubleClick={handleFileDoubleClick}
        onFileRightClick={onFileRightClick}
        onBgRightClick={onBgRightClick}
        getFolderSize={getFolderSize}
        isCalculatingSize={isCalculatingSize}
        calculateFolderSize={calculateFolderSize}
        setBottomPanelCollapsed={setBottomPanelCollapsed}
        setBottomPanelTab={setBottomPanelTab}
        onAdvancedSelection={onAdvancedSelection}
        onQuickLook={onQuickLook}
        onRenameFile={renameFileInline}
        onCreateFile={() => handleCreateFile(currentPath)}
        onCompress={selectedEntries.length > 0 ? () => handleCompress(selectedEntries) : undefined}
        onExtract={
          singleSelectedEntry && selectedEntryIsArchive
            ? () => handleExtract(singleSelectedEntry)
            : undefined
        }
        onProperties={singleSelectedEntry ? () => handleProperties(singleSelectedEntry) : undefined}
      />
    );
  };

  // Pane-level drop target: allows dropping files anywhere in the pane
  // (cross-pane drag, or dropping on empty space). Folder-level data-drop-target
  // attributes inside FileGrid take priority via closest().
  const isEditorTab = activeTab?.type === 'editor';
  const isDroppablePath =
    !isEditorTab &&
    !currentPath.startsWith('wisp://') &&
    !currentPath.startsWith('gdrive://') &&
    !currentPath.startsWith('collection://') &&
    !isWebPath;

  // Only show PaneTabBar when there are multiple tabs or multiple panes
  const showTabBar = group.tabs.length > 1 || totalGroups > 1;

  return (
    <div
      className={`flex h-full flex-col overflow-hidden ${isActive ? 'ring-1 ring-xp-blue/30' : ''}`}
      data-drop-target={isDroppablePath ? currentPath : undefined}
      data-is-folder={isDroppablePath ? 'true' : undefined}
      onMouseDown={() => {
        if (!isActive) onSetActiveGroup(group.id);
      }}
    >
      {/* Tab bar — shown when multiple tabs or multiple panes */}
      {showTabBar && (
        <PaneTabBar
          groupId={group.id}
          tabs={group.tabs}
          activeTabId={group.activeTabId}
          isActiveGroup={isActive}
          canClose={canClose}
          onSwitchTab={(tabId) => onSwitchTab(group.id, tabId)}
          onCloseTab={(tabId) => onCloseTab(group.id, tabId)}
          onAddTab={() => onAddTab(group.id)}
          onSplitHorizontal={() => onSplitHorizontal(group.id)}
          onSplitVertical={() => onSplitVertical(group.id)}
          onCloseGroup={() => onCloseGroup(group.id)}
          onFocus={() => {
            if (!isActive) onSetActiveGroup(group.id);
          }}
          onTogglePin={onTogglePin ? (tabId) => onTogglePin(group.id, tabId) : undefined}
          onDuplicateTab={onDuplicateTab ? (tabId) => onDuplicateTab(group.id, tabId) : undefined}
          onCloseOtherTabs={
            onCloseOtherTabs ? (tabId) => onCloseOtherTabs(group.id, tabId) : undefined
          }
          onCloseTabsToRight={
            onCloseTabsToRight ? (tabId) => onCloseTabsToRight(group.id, tabId) : undefined
          }
          onCloseAllTabs={onCloseAllTabs ? () => onCloseAllTabs(group.id) : undefined}
          onReorderTab={onReorderTab ? (from, to) => onReorderTab(group.id, from, to) : undefined}
          isMaximized={isMaximized}
          onMaximizePane={onMaximizePane ? () => onMaximizePane(group.id) : undefined}
          onRestorePane={onRestorePane}
          paneSyncEnabled={paneSyncEnabled}
          paneSyncMode={paneSyncMode}
          onTogglePaneSync={onTogglePaneSync}
          onSwitchPaneSyncMode={onSwitchPaneSyncMode}
          hasMultiplePanes={totalGroups > 1}
        />
      )}

      {/* Navigation / Address Bar */}
      {!isEditorTab && (
        <NavigationBar
          currentPath={currentPath}
          navigateToPath={sharedActions.navigateToPath}
          refetch={refetch}
          active={isActive}
          onNavigateBack={onNavigateBackHistory ? () => onNavigateBackHistory(group.id) : undefined}
          canNavigateBack={group.historyIndex > 0}
          onNavigateForward={
            onNavigateForwardHistory ? () => onNavigateForwardHistory(group.id) : undefined
          }
          canNavigateForward={group.historyIndex < group.pathHistory.length - 1}
          onNavigateUp={handlePaneNavigateUp}
          canNavigateUp={canNavigateUp}
        />
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <ErrorBoundary>{renderContent()}</ErrorBoundary>
      </div>
    </div>
  );
};

export default EditorGroupPane;
