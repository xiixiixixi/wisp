import { useEffect, useRef, useState } from 'react';
import { useWindowEvent } from '@/hooks/use-window-event';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { patchUiState } from '@/lib/ui-state';
import { formatError } from '@/lib/file-operation-helpers';
import { invertSelection } from '@/extensions/advanced-selection/selection-utils';
import {
  getBookmarkBySlot,
  setPathBookmark as assignPathBookmark,
  getFolderName,
} from '@/lib/path-bookmarks';
import { extensionHost } from '@/lib/extension-host';
import { startTour, isTourCompleted } from '@/hooks/use-tour';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useVimMode, isVimModeEnabled, type VimModeActions } from '@/hooks/use-vim-mode';
import {
  AGENT_LAUNCH_REQUEST_EVENT,
  requestAgentLaunch,
} from '@/components/panels/agent-manager/agent-launch-request';
import type { TabItem, EditorGroup } from '@/types/split-view';
import type { BottomPanelTabId } from '@/hooks/use-layout-state';
import type { SortField } from '@/lib/utils';
import type { SplitLayoutHook } from '@/hooks/use-split-layout';
import type { Toast } from '@/hooks/use-toast';
import type { ClipboardState } from '@/hooks/use-context-menu';
import type { ContextMenuAction } from '@/lib/context-menu-factory';
import type { FileChangeSet } from '@/hooks/use-focus-change-tracker';
import type { TopBarHandle } from '@/components/explorer/TopBar';
import type { LeftSidebarHandle } from '@/components/explorer/LeftSidebar';

// ── Types ────────────────────────────────────────────────────────────────────

interface WispWindowState {
  currentPath: string;
  selectedFiles: Array<{ name: string; path: string; is_dir: boolean }>;
  navigateTo: (path: string) => void;
}

interface WindowWithWisp {
  __wisp_state__?: WispWindowState;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WispEffectsDeps {
  currentPath: string;
  files: FileEntry[];
  selectedFiles: Set<string>;
  setSelectedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedFile: FileEntry | null;
  setSelectedFile: React.Dispatch<React.SetStateAction<FileEntry | null>>;
  filteredFiles: FileEntry[];
  refetch: () => void;
  toast: (opts: Toast) => void;
  pendingSelectRef: React.MutableRefObject<string | null>;
  topBarRef: React.RefObject<TopBarHandle | null>;
  leftSidebarRef?: React.RefObject<LeftSidebarHandle | null>;
  /** Toggle the Quick Look overlay for a file (dialogManager) */
  toggleQuickLook: (file: import('@/lib/tauri-api').FileEntry) => void;
  /** Toggle hidden-file visibility + persist the setting (wisp.tsx) */
  toggleHiddenFiles: () => void;

  // Navigation
  navigateWithHistory: (path: string) => void;
  navigateUp: () => void;
  navigateBackInHistory: () => void;
  navigateForwardInHistory: () => void;
  setCurrentPath: (path: string) => void;
  handleFileDoubleClick: (file: FileEntry) => void;

  // Split layout
  splitLayoutRef: React.MutableRefObject<SplitLayoutHook>;
  activeGroupRef: React.MutableRefObject<EditorGroup>;
  navigateToPathRef: React.MutableRefObject<(path: string) => void>;
  splitLayout: SplitLayoutHook;
  activeGroup: EditorGroup;
  tabs: TabItem[];
  activeTab: string | null;

  // Layout state
  viewMode: string;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;
  leftSidebarCollapsed: boolean;
  setLeftSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  bottomPanelCollapsed: boolean;
  setBottomPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  rightPanelTab: string;
  setRightPanelTab: React.Dispatch<React.SetStateAction<string>>;
  bottomPanelTab: BottomPanelTabId;
  setBottomPanelTab: React.Dispatch<React.SetStateAction<BottomPanelTabId>>;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  bottomPanelHeight: number;
  searchPanelOpen: boolean;
  setSearchPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  theme: string;

  // Dialog state setters
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  commandPaletteOpen: boolean;
  setWorkspaceLayoutDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPathBookmarksDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShortcutsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowChangeSummaryToast: React.Dispatch<React.SetStateAction<boolean>>;

  // File operations
  fileOps: {
    clipboard: ClipboardState | null;
    setClipboard: (val: ClipboardState | null) => void;
    copySelectedFiles: () => void;
    cutSelectedFiles: () => void;
    pasteFiles: () => Promise<void>;
    pasteFilesAsMove: () => Promise<void>;
    deleteSelectedFiles: () => Promise<void>;
    handleDelete: () => Promise<void>;
    handleCreateFolder: () => Promise<void>;
    contextMenuActions: ContextMenuAction;
  };

  // File changes
  fileChanges: FileChangeSet | null;

  // Google Drive
  openGDriveTab: (accountId: string, accountName: string) => void;
  openGDriveManager: () => void;

  // Vim actions
  vimActions: VimModeActions;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export const useWispEffects = (deps: WispEffectsDeps) => {
  const {
    currentPath,
    files,
    selectedFiles,
    setSelectedFiles,
    selectedFile,
    setSelectedFile,
    filteredFiles,
    refetch,
    toast,
    pendingSelectRef,
    topBarRef: _topBarRef,
    leftSidebarRef,
    toggleQuickLook,
    toggleHiddenFiles,
    navigateWithHistory,
    navigateUp,
    navigateBackInHistory,
    navigateForwardInHistory,
    setCurrentPath,
    handleFileDoubleClick: _handleFileDoubleClick,
    splitLayoutRef,
    activeGroupRef,
    navigateToPathRef,
    splitLayout,
    activeGroup,
    tabs,
    activeTab,
    viewMode,
    setViewMode,
    leftSidebarCollapsed,
    setLeftSidebarCollapsed,
    rightSidebarCollapsed,
    setRightSidebarCollapsed,
    bottomPanelCollapsed,
    setBottomPanelCollapsed,
    rightPanelTab,
    setRightPanelTab,
    bottomPanelTab,
    setBottomPanelTab,
    leftSidebarWidth,
    rightSidebarWidth,
    bottomPanelHeight,
    searchPanelOpen: _searchPanelOpen,
    setSearchPanelOpen,
    sortBy,
    sortOrder,
    theme,
    setCommandPaletteOpen,
    commandPaletteOpen: _commandPaletteOpen,
    setWorkspaceLayoutDialogOpen,
    setPathBookmarksDialogOpen,
    setShortcutsDialogOpen,
    setShowChangeSummaryToast,
    fileOps,
    fileChanges,
    openGDriveTab,
    openGDriveManager,
    vimActions,
  } = deps;

  // ── Show toast when file changes are detected ──────────────────────────────
  useEffect(() => {
    if (fileChanges && fileChanges.totalCount > 0) {
      setShowChangeSummaryToast(true);
    }
  }, [fileChanges, setShowChangeSummaryToast]);

  // ── Auto-select file after navigating from search results ──────────────────
  useEffect(() => {
    if (pendingSelectRef.current && files.length > 0) {
      const target = pendingSelectRef.current;
      pendingSelectRef.current = null;
      const file = files.find((f) => f.path === target);
      if (file) {
        setSelectedFile(file);
        setSelectedFiles(new Set([file.path]));
      }
    }
  }, [files, pendingSelectRef, setSelectedFile, setSelectedFiles]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useShortcuts(
    {
      onCopy: fileOps.copySelectedFiles,
      onCut: fileOps.cutSelectedFiles,
      onPaste: fileOps.pasteFiles,
      onPasteMove: () => {
        void fileOps.pasteFilesAsMove();
      },
      onDelete: fileOps.deleteSelectedFiles,
      onRename: () => {
        if (selectedFiles.size === 1) {
          const filePath = Array.from(selectedFiles)[0];
          window.dispatchEvent(
            new CustomEvent('start-inline-rename', { detail: { path: filePath } }),
          );
        }
      },
      onNewFolder: async () => {
        if (
          !currentPath ||
          currentPath.startsWith('wisp://') ||
          currentPath.startsWith('collection://')
        ) {
          return;
        }
        await fileOps.contextMenuActions.createFolder(currentPath);
      },
      onNewFile: async () => {
        if (
          !currentPath ||
          currentPath.startsWith('wisp://') ||
          currentPath.startsWith('collection://')
        ) {
          return;
        }
        await fileOps.contextMenuActions.createFile(currentPath);
      },
      onQuickLook: () => {
        if (selectedFile) toggleQuickLook(selectedFile);
      },
      onUndo: () => {
        TauriAPI.undoOperation()
          .then((result) => {
            if (result.success) {
              toast({ title: 'Undo', description: result.message });
              refetch();
            }
          })
          .catch((err) => {
            console.error('Undo operation failed:', err);
            toast({ variant: 'destructive', title: 'Undo Failed', description: formatError(err) });
          });
      },
      onRedo: () => {
        TauriAPI.redoOperation()
          .then((result) => {
            if (result.success) {
              toast({ title: 'Redo', description: result.message });
              refetch();
            }
          })
          .catch((err) => {
            console.error('Redo operation failed:', err);
            toast({ variant: 'destructive', title: 'Redo Failed', description: formatError(err) });
          });
      },
      onSelectAll: () => {
        if (files) setSelectedFiles(new Set(files.map((f) => f.path)));
      },
      onClearSelection: () => {
        setSelectedFiles(new Set());
      },
      onInvertSelection: () => {
        if (files) {
          const inverted = invertSelection(files, selectedFiles);
          setSelectedFiles(new Set(inverted));
        }
      },
      onDuplicate: async () => {
        if (
          selectedFiles.size === 0 ||
          !currentPath ||
          currentPath.startsWith('wisp://') ||
          currentPath.startsWith('collection://')
        ) {
          return;
        }
        const filesToDuplicate = Array.from(selectedFiles);
        let duplicated = 0;
        for (const filePath of filesToDuplicate) {
          try {
            const sep = filePath.includes('/') ? '/' : '\\';
            const lastSepIdx = filePath.lastIndexOf(sep);
            const parentDir = filePath.substring(0, lastSepIdx);
            const fileName = filePath.substring(lastSepIdx + 1);
            const dotIdx = fileName.lastIndexOf('.');
            const baseName = dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName;
            const ext = dotIdx > 0 ? fileName.substring(dotIdx) : '';
            const destPath = `${parentDir}${sep}${baseName} - Copy${ext}`;
            await TauriAPI.acceleratedCopyFile(filePath, destPath);
            duplicated++;
          } catch (err) {
            toast({
              variant: 'destructive',
              title: 'Duplicate Failed',
              description: formatError(err),
            });
          }
        }
        if (duplicated > 0) {
          refetch();
          toast({
            title: 'Duplicated',
            description: `Duplicated ${duplicated} item${duplicated > 1 ? 's' : ''}`,
          });
        }
      },
      onCopyPath: () => {
        const first = Array.from(selectedFiles)[0];
        const file = first ? files?.find((f) => f.path === first) : undefined;
        if (file) fileOps.contextMenuActions.copyPath(file);
      },
      onOpen: () => {
        const first = Array.from(selectedFiles)[0];
        const file = first ? files?.find((f) => f.path === first) : undefined;
        if (file) _handleFileDoubleClick(file);
      },
      onProperties: () => {
        const first = Array.from(selectedFiles)[0];
        const file = first ? files?.find((f) => f.path === first) : undefined;
        if (file) fileOps.contextMenuActions.properties(file);
      },
      onRefresh: () => {
        refetch();
      },
      onNavigateUp: () => {
        navigateUp();
      },
      onNavigateBack: () => {
        navigateBackInHistory();
      },
      onNavigateForward: () => {
        navigateForwardInHistory();
      },
      onGoHome: () => {
        setCurrentPath('wisp://home');
      },
      onGoToPath: () => {
        // Finder's ⇧⌘G: focus the active pane's address bar for typing a path
        window.dispatchEvent(new CustomEvent('wisp-focus-address-bar'));
      },
      onGoToSpecial: (folder: string) => {
        if (folder === 'applications') {
          navigateWithHistory('/Applications');
          return;
        }
        const folderKey = folder as 'desktop' | 'downloads' | 'documents';
        TauriAPI.getUserDirectories()
          .then((dirs) => {
            const target = dirs[folderKey];
            if (target) navigateWithHistory(target);
          })
          .catch((err) => console.error('Failed to resolve special folder:', err));
      },
      onToggleHiddenFiles: () => {
        toggleHiddenFiles();
      },
      onToggleLeftSidebar: () => {
        setLeftSidebarCollapsed((prev) => !prev);
      },
      onToggleRightSidebar: () => {
        setRightSidebarCollapsed((prev) => !prev);
      },
      onToggleBottomPanel: () => {
        setBottomPanelCollapsed((prev) => !prev);
      },
      onTogglePreview: () => {
        setRightSidebarCollapsed(!rightSidebarCollapsed);
        if (rightSidebarCollapsed) setRightPanelTab('preview');
      },
      onOpenTerminal: () => {
        setBottomPanelCollapsed(false);
        setBottomPanelTab('terminal');
      },
      onSearch: () => {
        leftSidebarRef?.current?.focusSearch();
      },
      onQuickSearch: () => {
        setCommandPaletteOpen(true);
      },
      onNaturalLanguageSearch: () => {
        // Matches the behaviour this key had before it became configurable:
        // open the AI search panel and reveal the sidebar
        setSearchPanelOpen((prev) => !prev);
        setLeftSidebarCollapsed(false);
      },
      onOpenSettings: () => {
        window.dispatchEvent(new CustomEvent('wisp-open-settings'));
      },
      onQuit: () => {
        import('@tauri-apps/api/window')
          .then(({ getCurrentWindow }) => getCurrentWindow().close())
          .catch((err) => console.error('Failed to quit:', err));
      },
      onNewTab: () => {
        const name = currentPath.split(/[/\\]/).pop() || currentPath;
        splitLayout.addTab(
          activeGroup.id,
          { id: `folder-${Date.now()}`, name, path: currentPath, type: 'folder' },
          true,
        );
        refetch();
      },
      onToggleFullscreen: () => {
        document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen();
      },
      onNewWindow: () => {
        window.open(window.location.href, '_blank');
      },
      onSwitchViewMode: () => {
        const modes = ['list', 'small', 'medium', 'large'];
        const currentIndex = modes.indexOf(viewMode);
        setViewMode(modes[(currentIndex + 1) % modes.length]);
      },
      onSetViewMode: (mode: string) => {
        setViewMode(mode);
      },
      onZoomIn: () => {
        const current = parseFloat(document.documentElement.style.fontSize || '16');
        document.documentElement.style.fontSize = `${Math.min(current + 1, 24)}px`;
      },
      onZoomOut: () => {
        const current = parseFloat(document.documentElement.style.fontSize || '16');
        document.documentElement.style.fontSize = `${Math.max(current - 1, 10)}px`;
      },
      onCloseTab: () => {
        splitLayout.closeTab(activeGroup.id, activeGroup.activeTabId);
      },
      onNextTab: () => {
        const ci = tabs.findIndex((t) => t.id === activeTab);
        splitLayout.switchTab(activeGroup.id, tabs[(ci + 1) % tabs.length].id);
      },
      onPreviousTab: () => {
        const ci = tabs.findIndex((t) => t.id === activeTab);
        splitLayout.switchTab(activeGroup.id, tabs[ci === 0 ? tabs.length - 1 : ci - 1].id);
      },
      onToggleShortcutsDialog: () => {
        setShortcutsDialogOpen((prev) => !prev);
      },
      onToggleWorkspaceLayoutDialog: () => {
        setWorkspaceLayoutDialogOpen((prev) => !prev);
      },
      onToggleBookmarksDialog: () => {
        setPathBookmarksDialogOpen((prev) => !prev);
      },
      onSplitPaneVertical: () => {
        splitLayoutRef.current.splitGroup(activeGroupRef.current.id, 'vertical');
      },
      onSplitPaneHorizontal: () => {
        splitLayoutRef.current.splitGroup(activeGroupRef.current.id, 'horizontal');
      },
      onToggleAgentLauncher: () => {
        setRightSidebarCollapsed(false);
        setRightPanelTab('agent-manager');
      },
      onToggleAgentWorkspace: () => {
        setRightSidebarCollapsed(false);
        setRightPanelTab('agent-manager');
      },
    },
    'file-explorer',
  );

  // ── Split-pane keyboard shortcuts ─────────────────────────────────────────
  // (Handled by the configurable shortcut system: ⌘\ and ⌘⇧\ — see the
  // split-vertical / split-horizontal bindings.)

  // ── Command Palette ────────────────────────────────────────────────────────
  // All key-triggered behaviours above (Quick Look, undo/redo, dialogs, view
  // modes…) are owned by the configurable shortcut system, so the settings UI
  // and the cheat sheet always show the keys that actually fire. This listener
  // only bridges the programmatic "open palette" event.
  useEffect(() => {
    const handleOpenCommandPalette = () => setCommandPaletteOpen(true);
    window.addEventListener('wisp-open-command-palette', handleOpenCommandPalette);
    return () => window.removeEventListener('wisp-open-command-palette', handleOpenCommandPalette);
  }, [setCommandPaletteOpen]);

  // ── Path Bookmarks keyboard shortcuts ─────────────────────────────────────
  // Slots use ⌥⌘1-9 (jump) / ⌥⇧⌘1-9 (save current folder). ⌘1-⌘4 stay free
  // for Finder's view-mode shortcuts, which live in the configurable
  // shortcut system.
  useEffect(() => {
    const handleBookmarkKeys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (!e.altKey) return;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput) return;

      const digitFromKey = /^[1-9]$/.test(e.key) ? parseInt(e.key, 10) : 0;
      const digitFromCode = /^Digit[1-9]$/.test(e.code)
        ? parseInt(e.code.replace('Digit', ''), 10)
        : 0;
      const slot = digitFromKey || digitFromCode;
      if (slot < 1 || slot > 9) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        if (currentPath && !currentPath.startsWith('wisp://')) {
          assignPathBookmark(slot, currentPath);
          toast({ title: `Saved to bookmark ${slot}`, description: getFolderName(currentPath) });
        }
      } else {
        const bm = getBookmarkBySlot(slot);
        if (bm) {
          navigateWithHistory(bm.path);
          toast({ title: `Bookmark ${slot}`, description: bm.label || getFolderName(bm.path) });
        }
      }
    };
    document.addEventListener('keydown', handleBookmarkKeys, true);
    return () => document.removeEventListener('keydown', handleBookmarkKeys, true);
  }, [currentPath, toast, navigateWithHistory]);

  // ── Initialize extension system (deferred — open folder first) ───────────
  useEffect(() => {
    // Defer extension loading so the folder renders immediately.
    // Extensions load after the first paint + a short idle period.
    const timer = setTimeout(() => extensionHost.loadInstalledExtensions(), 300);
    (window as unknown as WindowWithWisp).__wisp_state__ = {
      currentPath: '',
      selectedFiles: [] as Array<{ name: string; path: string; is_dir: boolean }>,
      navigateTo: (path: string) => navigateToPathRef.current(path),
    };
    return () => {
      clearTimeout(timer);
      delete (window as unknown as WindowWithWisp).__wisp_state__;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync currentPath to extension state ───────────────────────────────────
  useEffect(() => {
    const state = (window as unknown as WindowWithWisp).__wisp_state__;
    if (state) {
      state.currentPath = currentPath;
    }
    window.dispatchEvent(
      new CustomEvent('wisp-state-change', {
        detail: { type: 'currentPath', value: currentPath },
      }),
    );
  }, [currentPath]);

  // Auto-start onboarding tour only on truly first launch (never seen the app before)
  useEffect(() => {
    // If any setting exists in localStorage, user has used the app before — skip tour
    const hasUsedApp =
      localStorage.getItem('wisp:settings') !== null ||
      localStorage.getItem('wisp:tour-completed') === 'true';
    if (!hasUsedApp && !isTourCompleted()) {
      const timer = setTimeout(() => startTour(), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  // ── Sync selectedFiles to extension state ─────────────────────────────────
  useEffect(() => {
    const state = (window as unknown as WindowWithWisp).__wisp_state__;
    if (state) {
      const mapped = Array.from(selectedFiles).map((p) => {
        const entry = files?.find((f) => f.path === p);
        const name = p.split(/[/\\]/).pop() || p;
        return { name: entry?.name || name, path: p, is_dir: entry?.is_dir ?? false };
      });
      state.selectedFiles = mapped;
      window.dispatchEvent(
        new CustomEvent('wisp-state-change', {
          detail: { type: 'selectedFiles', value: mapped },
        }),
      );
    }
  }, [selectedFiles, files]);

  // ── File watcher ──────────────────────────────────────────────────────────
  // Directory watching lives in EditorGroupPane: every pane watches its own
  // folder, which also covers split view (inactive panes refresh too) and
  // handles a deleted current folder by navigating to a surviving ancestor.

  // ── Mouse side buttons (back/forward) ─────────────────────────────────────
  // Desktop: the backend NSEvent monitor emits `mouse-back` / `mouse-forward`
  // (WKWebView does not reliably surface auxiliary buttons to the DOM).
  // Web: browsers deliver them as mouseup with button 3 / 4 directly.
  useEffect(() => {
    if (isTauri()) {
      let disposed = false;
      const unlisteners: Array<() => void> = [];
      (async () => {
        const back = await TauriAPI.listenToEvent('mouse-back', () => navigateBackInHistory());
        if (disposed) return void back();
        unlisteners.push(back);
        const forward = await TauriAPI.listenToEvent('mouse-forward', () =>
          navigateForwardInHistory(),
        );
        if (disposed) return void forward();
        unlisteners.push(forward);
      })().catch(console.error);
      return () => {
        disposed = true;
        unlisteners.forEach((unlisten) => unlisten());
      };
    }
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        navigateBackInHistory();
      } else if (event.button === 4) {
        event.preventDefault();
        navigateForwardInHistory();
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [navigateBackInHistory, navigateForwardInHistory]);

  // ── Vim mode ──────────────────────────────────────────────────────────────
  const [vimEnabled, setVimEnabled] = useState(() => isVimModeEnabled());
  useWindowEvent('focus', () => setVimEnabled(isVimModeEnabled()));
  useWindowEvent('storage', (e: StorageEvent) => {
    if (e.key === STORAGE_KEYS.VIM_MODE) setVimEnabled(e.newValue === 'true');
  });

  const vimState = useVimMode({
    enabled: vimEnabled,
    files: filteredFiles,
    selectedFiles,
    currentPath,
    clipboard: fileOps.clipboard,
    actions: vimActions,
  });

  // ── GDrive event listeners ────────────────────────────────────────────────
  useWindowEvent(
    'open-gdrive-tab',
    (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.accountId) {
        openGDriveTab(detail.accountId, detail.accountName || detail.accountId);
      }
    },
    [openGDriveTab],
  );
  useWindowEvent('open-gdrive-setup', () => openGDriveManager(), [openGDriveManager]);
  useWindowEvent('open-gdrive-management', () => openGDriveManager(), [openGDriveManager]);

  // ── Listen for folder-opened event (from shell integration / "Open with Wisp") ──
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        listen<string>('folder-opened', (event) => {
          if (event.payload && typeof event.payload === 'string') {
            navigateWithHistory(event.payload);
          }
        }).then((fn) => {
          unlisten = fn;
        });
      })
      .catch((err: unknown) => console.warn('Failed to listen for open-path event:', err));

    return () => {
      unlisten?.();
    };
  }, [navigateWithHistory]);

  // ── Persist UI state to localStorage (debounced) ──────────────────────────
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const patch: Record<string, unknown> = {
        viewMode,
        leftSidebarCollapsed,
        rightSidebarCollapsed,
        bottomPanelCollapsed,
        rightPanelTab,
        bottomPanelTab,
        leftSidebarWidth,
        rightSidebarWidth,
        bottomPanelHeight,
        theme,
        sortBy,
        sortOrder,
      };
      if (
        currentPath &&
        !currentPath.startsWith('wisp://') &&
        !currentPath.startsWith('collection://') &&
        !currentPath.startsWith('gdrive://') &&
        !currentPath.startsWith('comparison://')
      ) {
        patch.lastRealPath = currentPath;
      }
      patchUiState(patch);
    }, 300);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    viewMode,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    bottomPanelCollapsed,
    rightPanelTab,
    bottomPanelTab,
    leftSidebarWidth,
    rightSidebarWidth,
    bottomPanelHeight,
    theme,
    sortBy,
    sortOrder,
    currentPath,
  ]);

  // ── Extension: openInEditor event ─────────────────────────────────────────
  useWindowEvent(
    'wisp-open-in-editor',
    (e: Event) => {
      const { path } = (e as CustomEvent).detail;
      if (!path) return;
      // Check if path is a directory — if so, navigate instead of opening editor
      TauriAPI.readDirectory(path)
        .then(() => {
          // Success means it's a directory — navigate to it
          window.__wisp_state__?.navigateTo?.(path);
        })
        .catch(() => {
          // Not a directory — open as editor tab
          const name = path.split(/[/\\]/).pop() || path;
          const sl = splitLayoutRef.current;
          const group = sl.state.groups[sl.state.activeGroupId];
          const existing = group?.tabs.find((t: TabItem) => t.type === 'editor' && t.path === path);
          if (existing) {
            sl.switchTab(group.id, existing.id);
            return;
          }
          const tab: TabItem = {
            id: `editor-${path}-${Date.now()}`,
            name,
            path,
            type: 'editor',
          };
          sl.addTab(sl.state.activeGroupId, tab, true);
        });
    },
    [splitLayoutRef],
  );

  // ── Legacy AI request bridge ─────────────────────────────────────────────
  // Existing code actions now prefill the external Agent launcher instead of
  // opening the retired built-in chat loop.
  useWindowEvent(
    'wisp-ai-chat-request',
    (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt: string }>).detail?.prompt;
      if (prompt) {
        setRightSidebarCollapsed(false);
        setRightPanelTab('agent-manager');
        requestAgentLaunch(prompt);
      }
    },
    [setRightSidebarCollapsed, setRightPanelTab],
  );

  useWindowEvent(AGENT_LAUNCH_REQUEST_EVENT, () => {
    setRightSidebarCollapsed(false);
    setRightPanelTab('agent-manager');
  }, [setRightSidebarCollapsed, setRightPanelTab]);

  // ── Spring-loaded folder navigation ──────────────────────────────────────
  // When DragDropContext fires 'spring-load-folder' (a folder hovered for
  // 500ms while dragging), navigate into that folder automatically.
  useWindowEvent(
    'spring-load-folder',
    (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (path) navigateWithHistory(path);
    },
    [navigateWithHistory],
  );

  return {
    vimState,
    vimEnabled,
  };
};
