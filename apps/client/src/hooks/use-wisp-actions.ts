import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileEntry, type ConflictFileInfo } from '@/lib/tauri-api';
import {
  openRecentEntry,
  parentDirectory,
  resolveEntryPath,
  type EntryActionIntent,
} from '@/lib/recent-entry-actions';
import { isEditableFile } from '@/lib/editable-files';
import { formatError } from '@/lib/file-operation-helpers';
import type { TabItem, EditorGroup } from '@/types/split-view';
import type { SharedPaneActions } from '@/components/split-view/EditorGroupPane';
import type { WorkspaceLayoutUiState } from '@/lib/workspace-layouts';
import type { ConflictResolution } from '@/components/dialogs/FileConflictDialog';
import type { BottomPanelTabId } from '@/hooks/use-layout-state';
import type { SplitLayoutHook } from '@/hooks/use-split-layout';
import type { Toast } from '@/hooks/use-toast';
import type { ClipboardState } from '@/hooks/use-context-menu';
import type { ContextMenuAction } from '@/lib/context-menu-factory';
import type { DialogManagerResult } from '@/hooks/use-dialog-manager';
import type { CrossTabSelectionState } from '@/hooks/use-cross-tab-selection';
import type { TopBarHandle } from '@/components/explorer/TopBar';
import type { LeftSidebarHandle } from '@/components/explorer/LeftSidebar';
import type { FileCollection } from '@/lib/collections';
import { useNavigationActions } from './use-navigation-actions';
import { useFileActions } from './use-file-actions';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WispActionsDeps {
  currentPath: string;
  splitLayout: SplitLayoutHook;
  activeGroup: EditorGroup;
  selectedFiles: Set<string>;
  setSelectedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedFile: React.Dispatch<React.SetStateAction<FileEntry | null>>;
  files: FileEntry[];
  refetch: () => void;
  toast: (opts: Toast) => void;
  fileOps: {
    clipboard: ClipboardState | null;
    setClipboard: (val: ClipboardState | null) => void;
    contextMenuActions: ContextMenuAction;
    pasteFiles: () => Promise<void>;
    renameFileInline: (oldPath: string, newName: string) => Promise<boolean>;
  };
  ctxMenu: {
    handleFileRightClick: (file: FileEntry, event: React.MouseEvent) => void;
    handleBackgroundRightClick: (event: React.MouseEvent) => void;
  };
  dialogManager: DialogManagerResult;
  crossTabSelection: CrossTabSelectionState;
  theme: string;
  setTheme: (theme: string) => void;
  handleQuickLook: (file: FileEntry) => void;
  handleGDriveFileSelect: (file: FileEntry) => void;
  setPaneFiles: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  paneRefetchRef: React.MutableRefObject<() => void>;
  pendingSelectRef: React.MutableRefObject<string | null>;
  topBarRef: React.RefObject<TopBarHandle | null>;
  leftSidebarRef: React.RefObject<LeftSidebarHandle | null>;
  dismissFileChanges: () => void;

  // Layout state + setters
  viewMode: string;
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  setLeftSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setRightSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setBottomPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setBottomPanelTab: React.Dispatch<React.SetStateAction<BottomPanelTabId>>;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;

  // Dialog state setters
  setShowChangeSummaryToast: React.Dispatch<React.SetStateAction<boolean>>;
  setFileConflict: React.Dispatch<
    React.SetStateAction<{
      fileName: string;
      isDir: boolean;
      destination: string;
      remaining: number;
      sourceInfo?: ConflictFileInfo | null;
      destInfo?: ConflictFileInfo | null;
      resolve: (resolution: ConflictResolution, applyToAll: boolean) => void;
    } | null>
  >;
  setTemplatePickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setFolderCompareOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setFolderComparePaths: React.Dispatch<React.SetStateAction<{ left: string; right: string }>>;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setQuickLookFile: React.Dispatch<React.SetStateAction<FileEntry | null>>;
  setPathBookmarksDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setWorkspaceLayoutDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCrossTabDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShortcutsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCollectionEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingCollection: React.Dispatch<React.SetStateAction<FileCollection | null>>;
}

export const useWispActions = (deps: WispActionsDeps) => {
  const { t } = useTranslation();
  const {
    currentPath,
    splitLayout,
    activeGroup,
    selectedFiles: _selectedFiles,
    setSelectedFiles,
    setSelectedFile,
    files,
    refetch,
    toast,
    fileOps,
    ctxMenu,
    dialogManager,
    crossTabSelection,
    theme,
    setTheme,
    handleQuickLook,
    handleGDriveFileSelect,
    setPaneFiles,
    paneRefetchRef,
    pendingSelectRef,
    topBarRef: _topBarRef,
    dismissFileChanges,
    viewMode,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    bottomPanelCollapsed,
    setLeftSidebarCollapsed,
    setRightSidebarCollapsed,
    setBottomPanelCollapsed,
    setBottomPanelTab,
    setViewMode,
    setShowChangeSummaryToast,
    setFileConflict,
    setTemplatePickerOpen,
    setFolderCompareOpen,
    setFolderComparePaths: _setFolderComparePaths,
    setCommandPaletteOpen,
    setQuickLookFile,
    setPathBookmarksDialogOpen,
    setWorkspaceLayoutDialogOpen,
    setCrossTabDialogOpen,
    setShortcutsDialogOpen,
    setCollectionEditorOpen,
    setEditingCollection,
  } = deps;

  // Refs for splitLayout and activeGroup so callbacks stay stable
  const splitLayoutRef = useRef(splitLayout);
  splitLayoutRef.current = splitLayout;
  const activeGroupRef = useRef(activeGroup);
  activeGroupRef.current = activeGroup;
  const ctxMenuRef = useRef(ctxMenu);
  ctxMenuRef.current = ctxMenu;
  const fileOpsRef = useRef(fileOps);
  fileOpsRef.current = fileOps;
  const dialogManagerRef = useRef(dialogManager);
  dialogManagerRef.current = dialogManager;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const currentLocationRef = useRef({ path: currentPath, groupId: activeGroup.id });
  currentLocationRef.current = { path: currentPath, groupId: activeGroup.id };
  const revealSequenceRef = useRef(0);
  const pendingRevealRef = useRef<{
    path: string;
    directory: string;
    source: string;
    groupId: string;
    arrived: boolean;
  } | null>(null);
  const clearPendingReveal = useCallback(() => {
    pendingRevealRef.current = null;
    pendingSelectRef.current = null;
  }, [pendingSelectRef]);

  useEffect(() => {
    const request = pendingRevealRef.current;
    if (!request) return;
    if (
      activeGroup.id !== request.groupId ||
      (currentPath !== request.directory && (request.arrived || currentPath !== request.source))
    ) {
      clearPendingReveal();
    } else if (currentPath === request.directory) request.arrived = true;
  }, [currentPath, activeGroup.id, clearPendingReveal]);

  const finishPendingReveal = useCallback(
    (directory: string, directoryFiles: FileEntry[], succeeded: boolean) => {
      const request = pendingRevealRef.current;
      if (
        !request ||
        directory !== request.directory ||
        currentLocationRef.current.path !== directory ||
        currentLocationRef.current.groupId !== request.groupId
      ) {
        return;
      }
      // Only the target pane's settled query may consume this request. A stale
      // files array from the source pane cannot establish absence of a target.
      clearPendingReveal();
      const file = succeeded
        ? directoryFiles.find((entry) => entry.path === request.path)
        : undefined;
      if (file) {
        setSelectedFile(file);
        setSelectedFiles(new Set([file.path]));
      }
    },
    [clearPendingReveal, setSelectedFile, setSelectedFiles],
  );

  // ── Navigation (delegated to domain hook) ─────────────────────────────────

  const navigation = useNavigationActions({
    currentPath,
    splitLayoutRef,
    activeGroupRef,
  });

  // ── File / cross-tab actions (delegated to domain hook) ───────────────────

  const fileActions = useFileActions({
    splitLayoutRef,
    activeGroupRef,
    setSelectedFiles,
    setSelectedFile,
    toast,
    navigateWithHistory: navigation.navigateWithHistory,
    crossTabSelection,
    refetch,
    openOpenWithDialog: (...args) => dialogManagerRef.current.openOpenWithDialog(...args),
  });

  // ── Change summary toast handlers ──────────────────────────────────────────

  const handleReviewChanges = useCallback(() => {
    setShowChangeSummaryToast(false);
    setBottomPanelCollapsed(false);
    setBottomPanelTab('events');
  }, [setShowChangeSummaryToast, setBottomPanelCollapsed, setBottomPanelTab]);

  const handleDismissChangesToast = useCallback(() => {
    setShowChangeSummaryToast(false);
  }, [setShowChangeSummaryToast]);

  const handleDismissAllChanges = useCallback(() => {
    setShowChangeSummaryToast(false);
    dismissFileChanges();
  }, [dismissFileChanges, setShowChangeSummaryToast]);

  // ── Workspace layout save/restore ─────────────────────────────────────────

  const workspaceUiState: WorkspaceLayoutUiState = useMemo(
    () => ({
      viewMode,
      theme,
      leftSidebarCollapsed,
      rightSidebarCollapsed,
      bottomPanelCollapsed,
    }),
    [viewMode, theme, leftSidebarCollapsed, rightSidebarCollapsed, bottomPanelCollapsed],
  );

  const handleApplyLayout = useCallback(
    (newLayout: import('@/types/split-view').SplitLayoutState, uiState: WorkspaceLayoutUiState) => {
      splitLayoutRef.current.dispatch({ type: 'REPLACE_STATE', state: newLayout });
      setViewMode(uiState.viewMode);
      setTheme(uiState.theme);
      setLeftSidebarCollapsed(uiState.leftSidebarCollapsed);
      setRightSidebarCollapsed(uiState.rightSidebarCollapsed);
      setBottomPanelCollapsed(uiState.bottomPanelCollapsed);
    },
    [
      setTheme,
      setViewMode,
      setLeftSidebarCollapsed,
      setRightSidebarCollapsed,
      setBottomPanelCollapsed,
    ],
  );

  // ── Dialog close/action callbacks ─────────────────────────────────────────

  const handleCloseTemplatePicker = useCallback(
    () => setTemplatePickerOpen(false),
    [setTemplatePickerOpen],
  );
  const handleCloseFolderCompare = useCallback(
    () => setFolderCompareOpen(false),
    [setFolderCompareOpen],
  );
  const handleCloseCommandPalette = useCallback(
    () => setCommandPaletteOpen(false),
    [setCommandPaletteOpen],
  );
  const handleCommandPaletteFileSelect = useCallback(
    async (filePath: string, isDir: boolean | undefined, intent: EntryActionIntent = 'open') => {
      const sequence = ++revealSequenceRef.current;
      const source = currentLocationRef.current;
      clearPendingReveal();
      try {
        if (intent === 'open') {
          await openRecentEntry({ path: filePath, isDir }, navigation.navigateWithHistory, {
            openDemoFile: handleQuickLook,
          });
          return;
        }
        filePath = await resolveEntryPath(filePath);
        if (
          sequence !== revealSequenceRef.current ||
          currentLocationRef.current.path !== source.path ||
          currentLocationRef.current.groupId !== source.groupId
        ) {
          return;
        }
        const parentDir = parentDirectory(filePath);
        pendingRevealRef.current = {
          path: filePath,
          directory: parentDir,
          source: source.path,
          groupId: source.groupId,
          arrived: parentDir === source.path,
        };
        pendingSelectRef.current = filePath;
        if (parentDir && parentDir !== currentPath) {
          navigation.navigateWithHistory(parentDir);
        } else {
          const file = files.find((f) => f.path === filePath);
          if (file) {
            setSelectedFile(file);
            setSelectedFiles(new Set([file.path]));
            clearPendingReveal();
          } else {
            refetch();
          }
        }
      } catch (error) {
        if (sequence === revealSequenceRef.current) clearPendingReveal();
        toastRef.current({
          variant: 'destructive',
          title: t('toast.openFileFailed'),
          description: formatError(error),
        });
      }
    },
    [
      navigation,
      currentPath,
      files,
      pendingSelectRef,
      setSelectedFile,
      setSelectedFiles,
      handleQuickLook,
      t,
      refetch,
      clearPendingReveal,
    ],
  );
  const handleCloseQuickLook = useCallback(() => setQuickLookFile(null), [setQuickLookFile]);
  const handleClosePathBookmarks = useCallback(
    () => setPathBookmarksDialogOpen(false),
    [setPathBookmarksDialogOpen],
  );
  const handleCloseWorkspaceLayout = useCallback(
    () => setWorkspaceLayoutDialogOpen(false),
    [setWorkspaceLayoutDialogOpen],
  );
  const handleCloseCrossTabDialog = useCallback(
    () => setCrossTabDialogOpen(false),
    [setCrossTabDialogOpen],
  );
  const handleCloseShortcutsDialog = useCallback(
    () => setShortcutsDialogOpen(false),
    [setShortcutsDialogOpen],
  );
  const handleOpenSettings = useCallback(
    () => window.dispatchEvent(new CustomEvent('wisp-open-settings')),
    [],
  );
  const handleCloseCollectionEditor = useCallback(() => {
    setCollectionEditorOpen(false);
    setEditingCollection(null);
  }, [setCollectionEditorOpen, setEditingCollection]);

  // ── Shared actions bag for split panes ─────────────────────────────────────

  const sharedActions: SharedPaneActions = useMemo(
    () => ({
      handleFileOpen: async (file: FileEntry) => {
        // Finder parity: double-click opens EVERY file with the system
        // default application (an html goes to the browser, source editing
        // stays an explicit open-in-editor action).
        void isEditableFile;
        try {
          await openRecentEntry({ path: file.path, isDir: false }, navigation.navigateWithHistory, {
            openDemoFile: handleQuickLook,
          });
        } catch (err) {
          toastRef.current({
            variant: 'destructive',
            title: 'Open File Failed',
            description: formatError(err),
          });
        }
      },
      revealEntry: (path: string) => {
        void handleCommandPaletteFileSelect(path, undefined, 'reveal');
      },
      onDirectoryReady: finishPendingReveal,
      handleFileRightClick: (file: FileEntry, event: React.MouseEvent, _groupId: string) =>
        ctxMenuRef.current.handleFileRightClick(file, event),
      handleBackgroundRightClick: (event: React.MouseEvent, _groupId: string) =>
        ctxMenuRef.current.handleBackgroundRightClick(event),
      handleDelete: (filesToDelete: FileEntry[]) =>
        fileOpsRef.current.contextMenuActions.delete(filesToDelete),
      handleCreateFolder: (path: string) =>
        fileOpsRef.current.contextMenuActions.createFolder(path),
      handleCreateFile: (path: string) => fileOpsRef.current.contextMenuActions.createFile(path),
      handleCompress: (filesToCompress: FileEntry[]) =>
        fileOpsRef.current.contextMenuActions.compressTo(filesToCompress),
      handleExtract: (file: FileEntry) => fileOpsRef.current.contextMenuActions.extractHere(file),
      handleProperties: (file: FileEntry | FileEntry[]) =>
        fileOpsRef.current.contextMenuActions.properties(file),
      theme,
      setTheme,
      setBottomPanelCollapsed,
      setBottomPanelTab: (tab: string) => setBottomPanelTab(tab as BottomPanelTabId),
      onNavigateFromHome: (path: string, groupId: string) => {
        const newTab: TabItem = {
          id: path,
          name: path.split(/[\\/]/).pop() || path,
          path,
          type: 'folder',
        };
        splitLayoutRef.current.addTab(groupId, newTab, true);
      },
      onGDriveNavigate: (
        accountId: string,
        folderId: string,
        _folderName: string,
        groupId: string,
      ) => {
        splitLayoutRef.current.navigate(groupId, `gdrive://${accountId}/${folderId}`, folderId);
      },
      onGDriveFileSelect: handleGDriveFileSelect,
      onError: (title: string, description: string) => {
        toastRef.current({ variant: 'destructive', title, description });
      },
      onSelectAll: (_files: FileEntry[]) => {
        setSelectedFiles(new Set(_files.map((f) => f.path)));
      },
      onAdvancedSelection: () => dialogManagerRef.current.setShowAdvancedSelect(true),
      onQuickLook: handleQuickLook,
      renameFileInline: fileOps.renameFileInline,
      onFilesChange: (newFiles: FileEntry[], newRefetch: () => void) => {
        setPaneFiles(newFiles);
        paneRefetchRef.current = newRefetch;
      },
      navigateBackInHistory: navigation.navigateBackInHistory,
      navigateForwardInHistory: navigation.navigateForwardInHistory,
      canNavigateBackInHistory: navigation.canNavigateBackInHistory,
      canNavigateForwardInHistory: navigation.canNavigateForwardInHistory,
      navigateUp: navigation.navigateUp,
      navigateToPath: navigation.navigateWithHistory,
      refetchFiles: refetch,
    }),
    [
      theme,
      setTheme,
      setBottomPanelCollapsed,
      setBottomPanelTab,
      setPaneFiles,
      setSelectedFiles,
      paneRefetchRef,
      handleGDriveFileSelect,
      navigation.navigateBackInHistory,
      navigation.navigateForwardInHistory,
      navigation.canNavigateBackInHistory,
      navigation.canNavigateForwardInHistory,
      navigation.navigateUp,
      navigation.navigateWithHistory,
      refetch,
      handleQuickLook,
      handleCommandPaletteFileSelect,
      finishPendingReveal,
      fileOps.renameFileInline,
    ],
  );

  // ── Vim actions ───────────────────────────────────────────────────────────

  const vimActions = useMemo(
    () => ({
      navigateToPath: (path: string) => navigation.navigateWithHistory(path),
      navigateUp: navigation.navigateUp,
      openFile: (file: FileEntry) => fileActions.handleFileDoubleClick(file),
      setSelectedFiles,
      setSelectedFile,
      focusSearch: () => setCommandPaletteOpen(true),
      copyFiles: (filesToCopy: FileEntry[]) => {
        fileOps.setClipboard({ files: filesToCopy, operation: 'copy' });
        toast({
          title: t('toast.copied'),
          description: t('toast.yankedItemsDesc', { count: filesToCopy.length }),
        });
      },
      pasteFiles: () => {
        fileOps.pasteFiles();
      },
      deleteFiles: (filesToDelete: FileEntry[]) => {
        fileOps.contextMenuActions.delete(filesToDelete);
      },
      renameFile: (file: FileEntry) => {
        fileOps.contextMenuActions.rename(file);
      },
      addBookmark: (path: string) => {
        const name = path.split(/[/\\]/).pop() || path;
        TauriAPI.addBookmark(path, name)
          .then(() =>
            toast({
              title: t('toast.bookmarked'),
              description: t('toast.bookmarkAddedDesc', { name }),
            }),
          )
          .catch((err: unknown) =>
            toast({
              title: t('toast.bookmarkFailed'),
              description: formatError(err),
              variant: 'destructive',
            }),
          );
      },
      refetch,
      toast: (opts: { title: string; description?: string; variant?: string }) => {
        toast(opts as Parameters<typeof toast>[0]);
      },
    }),
    [
      fileOps,
      refetch,
      toast,
      navigation,
      fileActions,
      setSelectedFiles,
      setSelectedFile,
      setCommandPaletteOpen,
      t,
    ],
  );

  // ── File conflict resolver ────────────────────────────────────────────────

  const resolveConflict = useCallback(
    (
      fileName: string,
      isDir: boolean,
      destination: string,
      remaining: number,
      sourceInfo?: ConflictFileInfo | null,
      destInfo?: ConflictFileInfo | null,
    ) => {
      return new Promise<{ resolution: ConflictResolution; applyToAll: boolean }>((resolve) => {
        setFileConflict({
          fileName,
          isDir,
          destination,
          remaining,
          sourceInfo: sourceInfo ?? null,
          destInfo: destInfo ?? null,
          resolve: (resolution: ConflictResolution, applyToAll: boolean) => {
            setFileConflict(null);
            resolve({ resolution, applyToAll });
          },
        });
      });
    },
    [setFileConflict],
  );

  return {
    // Navigation
    setCurrentPath: navigation.setCurrentPath,
    navigateWithHistory: navigation.navigateWithHistory,
    navigateUp: navigation.navigateUp,
    navigateToPath: navigation.navigateToPath,
    navigateToHome: navigation.navigateToHome,
    navigateFromHome: navigation.navigateFromHome,
    navigateBackInHistory: navigation.navigateBackInHistory,
    navigateForwardInHistory: navigation.navigateForwardInHistory,
    canNavigateBackInHistory: navigation.canNavigateBackInHistory,
    canNavigateForwardInHistory: navigation.canNavigateForwardInHistory,

    // File click handlers
    addTab: fileActions.addTab,
    toggleFileSelection: fileActions.toggleFileSelection,
    handleFileClick: fileActions.handleFileClick,
    handleFileDoubleClick: fileActions.handleFileDoubleClick,

    // Change summary
    handleReviewChanges,
    handleDismissChangesToast,
    handleDismissAllChanges,

    // Google Drive
    openGDriveTab: fileActions.openGDriveTab,
    openGDriveManager: fileActions.openGDriveManager,

    // Cross-tab
    handleCrossTabPickFolder: fileActions.handleCrossTabPickFolder,
    handleCrossTabMoveAll: fileActions.handleCrossTabMoveAll,
    handleCrossTabCopyAll: fileActions.handleCrossTabCopyAll,
    handleCrossTabCompressAll: fileActions.handleCrossTabCompressAll,
    handleCrossTabDeleteAll: fileActions.handleCrossTabDeleteAll,

    // Workspace
    workspaceUiState,
    handleApplyLayout,

    // Dialog callbacks
    handleCloseTemplatePicker,
    handleCloseFolderCompare,
    handleCloseCommandPalette,
    handleCommandPaletteFileSelect,
    handleCloseQuickLook,
    handleClosePathBookmarks,
    handleCloseWorkspaceLayout,
    handleCloseCrossTabDialog,
    handleCloseShortcutsDialog,
    handleOpenSettings,
    handleCloseCollectionEditor,

    // Shared actions for panes
    sharedActions,

    // Vim
    vimActions,

    // File conflict
    resolveConflict,

    // Expose refs for effects hook
    splitLayoutRef,
    activeGroupRef,
    navigateToPathRef: navigation.navigateToPathRef,
  };
};
