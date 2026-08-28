import { useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { TauriAPI, type FileEntry, type ConflictFileInfo } from '@/lib/tauri-api';
import { notifyFilesChanged } from '@/lib/file-change-events';
import { PATH_SEPARATOR, detectSep } from '@/lib/constants';
import { showConfirmationToast, showInputToast } from '@/components/ui/Toast';
import type { BatchOperationType } from '@/components/dialogs/BatchConfirmDialog';
import { invertSelection } from '@/extensions/advanced-selection/selection-utils';
import { ContextMenuFactory, type ContextMenuAction } from '@/lib/context-menu-factory';
import type { TabItem } from '@/types/split-view';
import type { ClipboardEntry } from '@/hooks/use-clipboard-history';
import {
  formatError,
  findCopyName,
  setClipboardEntries,
  resolveSelectedFiles,
  findUniqueFilePath,
  type ClipboardState,
} from '@/lib/file-operation-helpers';
import { executePaste, showPasteResultToast } from '@/lib/paste-helpers';
import type { BottomPanelTabId } from '@/hooks/use-layout-state';
import type { SortField } from '@/lib/utils';
import { validateFileName, getExtension, stripExtension } from '@/lib/validate-filename';

// ── Re-exports (preserve public API) ─────────────────────────────────────────

export type { ClipboardState };
export { formatError };

/** Mirror an internal copy onto the system clipboard as file URLs so other
 *  apps (WeChat, Mail…) accept ⌘V as file attachments, matching Finder's ⌘C. */
const mirrorCopyToSystemClipboard = (files: FileEntry[]) => {
  TauriAPI.copyFilesToClipboard(files.map((f) => f.path)).catch((error) => {
    console.error('Failed to write files to system clipboard:', error);
  });
};

const getFileNameValidationError = (
  value: string,
  existingNames: string[],
  currentName: string,
  t: TFunction,
): string | undefined => {
  const validation = validateFileName(value, existingNames, currentName);
  if (validation.valid) return undefined;

  switch (validation.code) {
    case 'empty':
      return t('fileOperations.nameValidation.empty');
    case 'invalidCharacters':
      return t('fileOperations.nameValidation.invalidCharacters');
    case 'trailingDotOrSpace':
      return t('fileOperations.nameValidation.trailingDotOrSpace');
    case 'reservedName':
      return t('fileOperations.nameValidation.reservedName', { name: String(validation.detail) });
    case 'tooLong':
      return t('fileOperations.nameValidation.tooLong', {
        count: typeof validation.detail === 'number' ? validation.detail : 255,
      });
    case 'conflict':
      return t('fileOperations.nameValidation.conflict', { name: String(validation.detail) });
    default:
      return validation.message;
  }
};

// ── Types ────────────────────────────────────────────────────────────────────

interface UseFileOperationsDeps {
  currentPath: string;
  selectedFiles: Set<string>;
  setSelectedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  files: FileEntry[];
  refetch: () => void;
  toast: (opts: {
    title?: string;
    description?: string;
    variant?: 'default' | 'destructive';
  }) => void;
  splitLayout: {
    addTab: (groupId: string, tab: TabItem, activate: boolean) => void;
  };
  activeGroupId: string;
  fileComparison: {
    markedFile: FileEntry | null;
    compareFiles: (file1: FileEntry, file2?: FileEntry) => void;
    markFileForComparison: (file: FileEntry) => void;
    clearComparisonMark: () => void;
  };
  /** Dialog openers from useDialogManager */
  dialogs: {
    openPropertiesDialog: (path: string) => void;
    openOpenWithDialog: (
      path: string,
      onChoose?: (handler: import('@/hooks/use-open-with-prefs').OpenHandler) => void,
    ) => void;
    openCompressDialog: (files: FileEntry[]) => void;
    openBulkRenameDialog: (files: FileEntry[]) => void;
    openExtractDialog: (path: string) => void;
    openFileTagsDialog: (path: string) => void;
    openFileDetailsDialog: (path: string, tab?: 'notes' | 'annotations' | 'metadata') => void;
    openEncryptionDialog: (filePath: string, mode: 'encrypt' | 'decrypt') => void;
    openSecureDeleteDialog: (files: FileEntry[]) => void;
    openVersionHistoryDialog: (path: string) => void;
    openSymlinkDialog: (targetPath: string) => void;
    openPasteRenameDialog: (files: FileEntry[]) => void;
    openTemplatePicker: () => void;
    openFolderCompare: (leftPath: string, rightPath: string) => void;
    setShowAdvancedSelect: (show: boolean) => void;
    openBatchConfirmDialog: (
      operation: BatchOperationType,
      files: FileEntry[],
      onConfirm: () => void,
      destination?: string,
    ) => void;
    openBatchMetadataDialog: (files: FileEntry[]) => void;
  };
  setBottomPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setBottomPanelTab: React.Dispatch<React.SetStateAction<BottomPanelTabId>>;
  setTerminalCwd: React.Dispatch<React.SetStateAction<string>>;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;
  setSortBy: React.Dispatch<React.SetStateAction<SortField>>;
  setSortOrder: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>;
  navigateToPath: (path: string) => void;
  /** Called when paste detects a file name conflict. Returns the user's choice. */
  resolveConflict?: (
    fileName: string,
    isDir: boolean,
    destination: string,
    remaining: number,
    sourceInfo?: ConflictFileInfo | null,
    destInfo?: ConflictFileInfo | null,
  ) => Promise<{
    resolution: import('@/components/dialogs/FileConflictDialog').ConflictResolution;
    applyToAll: boolean;
  }>;
  /** Finder's extension-change guard: called when an inline rename would
   *  change a file's extension. 'keep-old' rewrites the name to keep the
   *  original extension; 'use-new' accepts the new one. */
  confirmExtensionChange?: (
    oldName: string,
    oldExt: string,
    newExt: string,
  ) => Promise<'use-new' | 'keep-old'>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export const useFileOperations = (deps: UseFileOperationsDeps) => {
  const { t } = useTranslation();
  const {
    currentPath,
    selectedFiles,
    setSelectedFiles,
    files,
    toast,
    splitLayout,
    activeGroupId,
    fileComparison,
    dialogs,
    setBottomPanelCollapsed,
    setBottomPanelTab,
    setTerminalCwd,
    setViewMode,
    setSortBy,
    setSortOrder,
    navigateToPath,
    resolveConflict,
    confirmExtensionChange,
  } = deps;

  // Use refs so that memoized actions (useMemo with [] deps) always read
  // the latest values without re-creating the action bag.
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const resolveConflictRef = useRef(resolveConflict);
  resolveConflictRef.current = resolveConflict;
  const confirmExtensionChangeRef = useRef(confirmExtensionChange);
  confirmExtensionChangeRef.current = confirmExtensionChange;
  const filesRef = useRef(files);
  filesRef.current = files;
  const splitLayoutRef = useRef(splitLayout);
  splitLayoutRef.current = splitLayout;
  const activeGroupIdRef = useRef(activeGroupId);
  activeGroupIdRef.current = activeGroupId;
  const fileComparisonRef = useRef(fileComparison);
  fileComparisonRef.current = fileComparison;
  const dialogsRef = useRef(dialogs);
  dialogsRef.current = dialogs;
  const selectedFilesRef = useRef(selectedFiles);
  selectedFilesRef.current = selectedFiles;
  const setSelectedFilesRef = useRef(setSelectedFiles);
  setSelectedFilesRef.current = setSelectedFiles;
  const setBottomPanelCollapsedRef = useRef(setBottomPanelCollapsed);
  setBottomPanelCollapsedRef.current = setBottomPanelCollapsed;
  const setBottomPanelTabRef = useRef(setBottomPanelTab);
  setBottomPanelTabRef.current = setBottomPanelTab;
  const setTerminalCwdRef = useRef(setTerminalCwd);
  setTerminalCwdRef.current = setTerminalCwd;
  const setViewModeRef = useRef(setViewMode);
  setViewModeRef.current = setViewMode;
  const setSortByRef = useRef(setSortBy);
  setSortByRef.current = setSortBy;
  const setSortOrderRef = useRef(setSortOrder);
  setSortOrderRef.current = setSortOrder;
  const navigateToPathRef = useRef(navigateToPath);
  navigateToPathRef.current = navigateToPath;

  /** Notify the app that files changed */
  const emitFilesChanged = useCallback(() => {
    void notifyFilesChanged();
  }, []);

  /** Dispatch an activity feed event for the activity panel */
  const emitFileActivity = useCallback(
    (type: string, path: string, name?: string, oldPath?: string) => {
      window.dispatchEvent(
        new CustomEvent('file-activity', {
          detail: {
            type,
            path,
            name: name || path.replace(/\\/g, '/').split('/').pop() || path,
            oldPath,
          },
        }),
      );
    },
    [],
  );

  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const clipboardRef = useRef<ClipboardState | null>(null);
  const setClipboardBoth = useCallback((val: ClipboardState | null) => {
    clipboardRef.current = val;
    setClipboard(val);
  }, []);

  // ── Shared paste executor ──────────────────────────────────────────────

  /** Run the paste pipeline for the given clipboard against a target directory. */
  const runPaste = useCallback(
    async (cb: ClipboardState, targetPath: string) => {
      const isCut = cb.operation === 'cut';

      const doPaste = async () => {
        const result = await executePaste({
          files: cb.files,
          operation: cb.operation,
          targetPath,
          resolveConflict: resolveConflictRef.current,
          emitFileActivity,
          emitFilesChanged,
        });

        if (isCut && result.succeeded > 0) {
          setClipboardBoth(null);
          contextMenuFactoryRef.current.clearClipboard();
        }

        showPasteResultToast(result, toastRef.current);
      };

      if (isCut && cb.files.length > 1) {
        dialogsRef.current.openBatchConfirmDialog('move', cb.files, doPaste, targetPath);
      } else {
        await doPaste();
      }
    },
    [emitFileActivity, emitFilesChanged, setClipboardBoth],
  );

  // Refs for stable callbacks so the useMemo below never needs to re-create
  const emitFileActivityRef = useRef(emitFileActivity);
  emitFileActivityRef.current = emitFileActivity;
  const emitFilesChangedRef = useRef(emitFilesChanged);
  emitFilesChangedRef.current = emitFilesChanged;
  const setClipboardBothRef = useRef(setClipboardBoth);
  setClipboardBothRef.current = setClipboardBoth;
  const runPasteRef = useRef(runPaste);
  runPasteRef.current = runPaste;

  // ── Context-menu action bag ────────────────────────────────────────────

  const contextMenuActions: ContextMenuAction = useMemo(
    () => ({
      openFile: async (file: FileEntry) => {
        if (file.is_dir) {
          navigateToPathRef.current(file.path);
        } else {
          try {
            await TauriAPI.openFile(file.path);
          } catch (error) {
            toastRef.current({
              title: tRef.current('fileOperations.openFailedTitle'),
              description: tRef.current('fileOperations.openFailedDesc', {
                name: file.name,
                error: formatError(error),
              }),
              variant: 'destructive',
            });
          }
        }
      },
      openInNewTab: (file: FileEntry) => {
        const newTab: TabItem = {
          id: `${file.path}-${Date.now()}`,
          name: file.name,
          path: file.path,
          type: file.is_dir ? 'folder' : 'file',
        };
        splitLayoutRef.current.addTab(activeGroupIdRef.current, newTab, true);
      },
      openInEditor: (file: FileEntry) => {
        const editorTab: TabItem = {
          id: `editor-${file.path}-${Date.now()}`,
          name: file.name,
          path: file.path,
          type: 'editor',
        };
        splitLayoutRef.current.addTab(activeGroupIdRef.current, editorTab, true);
      },

      // ── Clipboard operations ───────────────────────────────────────────
      copy: (filesToCopy: FileEntry[]) => {
        setClipboardEntries(
          filesToCopy,
          'copy',
          setClipboardBothRef.current,
          (f, op) => contextMenuFactoryRef.current.updateClipboard(f, op),
          (opts) =>
            toastRef.current({
              ...opts,
              description: tRef.current('fileOperations.itemsCopied', {
                count: filesToCopy.length,
              }),
            }),
        );
        mirrorCopyToSystemClipboard(filesToCopy);
      },
      cut: (filesToCut: FileEntry[]) => {
        setClipboardEntries(
          filesToCut,
          'cut',
          setClipboardBothRef.current,
          (f, op) => contextMenuFactoryRef.current.updateClipboard(f, op),
          (opts) =>
            toastRef.current({
              ...opts,
              description: tRef.current('fileOperations.itemsCut', { count: filesToCut.length }),
            }),
        );
      },
      paste: async (targetPath: string) => {
        const currentClipboard = clipboardRef.current;
        if (!currentClipboard) {
          toastRef.current({
            title: tRef.current('fileOperations.nothingToPasteTitle'),
            description: tRef.current('fileOperations.clipboardEmpty'),
            variant: 'destructive',
          });
          return;
        }
        await runPasteRef.current(currentClipboard, targetPath);
      },

      // ── Delete / rename / create ───────────────────────────────────────
      delete: async (filesToDelete: FileEntry[]) => {
        if (filesToDelete.length === 0) return;
        const doDelete = async () => {
          try {
            for (const file of filesToDelete) {
              await TauriAPI.moveToTrash(file.path);
              emitFileActivityRef.current('remove', file.path, file.name);
            }
            setSelectedFilesRef.current(new Set());
            emitFilesChangedRef.current();
            toastRef.current({
              title: tRef.current('fileOperations.movedToTrashTitle'),
              description: tRef.current('fileOperations.movedToTrashDesc', {
                count: filesToDelete.length,
              }),
            });
          } catch (error) {
            console.error('Delete operation failed:', error);
            toastRef.current({
              title: tRef.current('fileOperations.deleteFailedTitle'),
              description: tRef.current('fileOperations.deleteFailedDesc', {
                error: formatError(error),
              }),
              variant: 'destructive',
            });
          }
        };

        if (filesToDelete.length > 1) {
          dialogsRef.current.openBatchConfirmDialog('delete', filesToDelete, doDelete);
        } else {
          const result = await showConfirmationToast({
            title: tRef.current('fileOperations.moveToTrashTitle'),
            description: tRef.current('fileOperations.moveToTrashPrompt', {
              name: filesToDelete[0]?.name,
            }),
            confirmText: tRef.current('fileOperations.moveToTrashConfirm'),
            cancelText: tRef.current('common.cancel'),
          });
          if (result) await doDelete();
        }
      },
      rename: async (file: FileEntry) => {
        const newName = await showInputToast({
          title: tRef.current('fileOperations.renameTitle'),
          description: tRef.current('fileOperations.renameDescription'),
          placeholder: file.name,
          initialValue: file.name,
          selectNameWithoutExtension: !file.is_dir,
          validate: (value) =>
            getFileNameValidationError(
              value,
              filesRef.current.map((entry) => entry.name),
              file.name,
              tRef.current,
            ),
          submitText: tRef.current('fileOperations.renameAction'),
          cancelText: tRef.current('common.cancel'),
        });
        if (newName && newName !== file.name) {
          try {
            const pathParts = file.path.split(/[\\/]/);
            pathParts[pathParts.length - 1] = newName;
            const newPath = pathParts.join(PATH_SEPARATOR);
            await TauriAPI.rename(file.path, newPath);
            emitFileActivityRef.current('file-renamed', newPath, newName, file.path);
            emitFilesChangedRef.current();
            toastRef.current({
              title: tRef.current('toast.renamed'),
              description: tRef.current('toast.renamedDesc', { name: newName }),
            });
          } catch (error) {
            console.error('Rename operation failed:', error);
            toastRef.current({
              title: tRef.current('toast.renameFailed'),
              description: tRef.current('toast.renameFailedDesc', { error: formatError(error) }),
              variant: 'destructive',
            });
          }
        }
      },
      createFolder: async (parentPath: string) => {
        const folderName = await showInputToast({
          title: tRef.current('fileOperations.newFolderTitle'),
          description: tRef.current('fileOperations.newFolderDescription'),
          placeholder: tRef.current('fileOperations.folderNamePlaceholder'),
          validate: (value) =>
            getFileNameValidationError(
              value,
              filesRef.current.map((entry) => entry.name),
              '',
              tRef.current,
            ),
          submitText: tRef.current('fileOperations.createAction'),
          cancelText: tRef.current('common.cancel'),
        });
        if (folderName) {
          try {
            const folderPath = `${parentPath}${parentPath.endsWith(PATH_SEPARATOR) ? '' : PATH_SEPARATOR}${folderName}`;
            await TauriAPI.createDirRecursive(folderPath);
            emitFileActivityRef.current('create', folderPath, folderName);
            emitFilesChangedRef.current();
            toastRef.current({
              title: tRef.current('toast.folderCreated'),
              description: tRef.current('toast.folderCreatedDesc', { name: folderName }),
            });
          } catch (error) {
            console.error('Create folder operation failed:', error);
            toastRef.current({
              title: tRef.current('toast.createFolderFailed'),
              description: tRef.current('toast.createFolderFailedDesc', {
                error: formatError(error),
              }),
              variant: 'destructive',
            });
          }
        }
      },
      createFile: async (parentPath: string) => {
        const fileName = await showInputToast({
          title: tRef.current('fileOperations.newFileTitle'),
          description: tRef.current('fileOperations.newFileDescription'),
          placeholder: tRef.current('fileOperations.fileNamePlaceholder'),
          validate: (value) =>
            getFileNameValidationError(
              value,
              filesRef.current.map((entry) => entry.name),
              '',
              tRef.current,
            ),
          submitText: tRef.current('fileOperations.createAction'),
          cancelText: tRef.current('common.cancel'),
        });
        if (fileName) {
          try {
            const filePath = `${parentPath}${parentPath.endsWith(PATH_SEPARATOR) ? '' : PATH_SEPARATOR}${fileName}`;
            await TauriAPI.createFile(filePath);
            emitFileActivityRef.current('create', filePath, fileName);
            emitFilesChangedRef.current();
            toastRef.current({
              title: tRef.current('toast.fileCreated'),
              description: tRef.current('toast.fileCreatedDesc', { name: fileName }),
            });
          } catch (error) {
            console.error('Create file operation failed:', error);
            toastRef.current({
              title: tRef.current('toast.createFileFailed'),
              description: tRef.current('toast.createFileFailedDesc', {
                error: formatError(error),
              }),
              variant: 'destructive',
            });
          }
        }
      },

      // ── Simple dialog / action delegates ───────────────────────────────
      properties: (file: FileEntry) => {
        dialogsRef.current.openPropertiesDialog(file.path);
        setBottomPanelCollapsedRef.current(false);
        setBottomPanelTabRef.current('properties');
      },
      refresh: () => {
        emitFilesChangedRef.current();
        toastRef.current({
          title: tRef.current('toast.refreshed'),
          description: tRef.current('toast.refreshedDesc'),
        });
      },
      selectAll: () => {
        const allFilePaths = new Set(filesRef.current.map((f) => f.path));
        setSelectedFilesRef.current(allFilePaths);
        toastRef.current({
          title: tRef.current('toast.selectedAll'),
          description: tRef.current('common.selected', { count: filesRef.current.length }),
        });
      },
      invertSelection: () => {
        const inverted = invertSelection(filesRef.current, selectedFilesRef.current);
        setSelectedFilesRef.current(new Set(inverted));
        toastRef.current({
          title: tRef.current('toast.selectionInverted'),
          description: tRef.current('toast.selectionInvertedDesc', {
            selected: inverted.length,
            total: filesRef.current.length,
          }),
        });
      },
      openAdvancedSelection: () => {
        dialogsRef.current.setShowAdvancedSelect(true);
      },
      copyPath: (file: FileEntry) => {
        navigator.clipboard.writeText(file.path);
        toastRef.current({
          title: tRef.current('toast.pathCopied'),
          description: tRef.current('toast.pathCopiedDesc'),
        });
      },
      openInTerminal: (path: string) => {
        // Always open the built-in terminal panel immediately
        setBottomPanelCollapsedRef.current(false);
        setBottomPanelTabRef.current('terminal');
        setTerminalCwdRef.current(path);
        toastRef.current({
          title: tRef.current('toast.terminalOpened'),
          description: tRef.current('toast.terminalOpenedDesc', { path }),
        });
      },
      openRecycleBin: async () => {
        try {
          await TauriAPI.openRecycleBin();
          toastRef.current({
            title: tRef.current('toast.recycleBinOpened'),
            description: tRef.current('toast.recycleBinOpenedDesc'),
          });
        } catch (error) {
          console.error('Failed to open recycle bin:', error);
          toastRef.current({
            title: tRef.current('toast.recycleBinFailed'),
            description: tRef.current('toast.recycleBinFailedDesc', { error: formatError(error) }),
            variant: 'destructive',
          });
        }
      },
      openWith: (file: FileEntry) => {
        dialogsRef.current.openOpenWithDialog(file.path);
      },
      compressTo: (filesToCompress: FileEntry[]) => {
        dialogsRef.current.openCompressDialog(filesToCompress);
      },
      bulkRename: (filesToRename: FileEntry[]) => {
        dialogsRef.current.openBulkRenameDialog(filesToRename);
      },
      extractHere: (file: FileEntry) => {
        dialogsRef.current.openExtractDialog(file.path);
      },
      compareFiles: (file1: FileEntry, file2?: FileEntry) => {
        if (file2) {
          const comparisonTab: TabItem = {
            id: `comparison-${Date.now()}`,
            name: `${file1.name} \u2194 ${file2.name}`,
            path: `comparison://${file1.path}|${file2.path}`,
            type: 'comparison',
            comparisonData: { file1Path: file1.path, file2Path: file2.path },
          };
          splitLayoutRef.current.addTab(activeGroupIdRef.current, comparisonTab, true);
          fileComparisonRef.current.clearComparisonMark();
        } else {
          fileComparisonRef.current.compareFiles(file1, file2);
        }
      },
      markForComparison: (file: FileEntry) => {
        fileComparisonRef.current.markFileForComparison(file);
      },
      manageTags: (file: FileEntry) => {
        dialogsRef.current.openFileTagsDialog(file.path);
      },
      openFileDetails: (file: FileEntry, tab?: 'notes' | 'annotations' | 'metadata') => {
        dialogsRef.current.openFileDetailsDialog(file.path, tab);
      },
      encryptFile: (file: FileEntry) => {
        dialogsRef.current.openEncryptionDialog(file.path, 'encrypt');
      },
      decryptFile: (file: FileEntry) => {
        dialogsRef.current.openEncryptionDialog(file.path, 'decrypt');
      },
      secureDelete: (filesToDelete: FileEntry[]) => {
        dialogsRef.current.openSecureDeleteDialog(filesToDelete);
      },
      versionHistory: (file: FileEntry) => {
        dialogsRef.current.openVersionHistoryDialog(file.path);
      },
      duplicateFiles: async (filesToDuplicate: FileEntry[]) => {
        let duplicated = 0;
        for (const file of filesToDuplicate) {
          try {
            const sep = detectSep(file.path);
            const lastSepIdx = file.path.lastIndexOf(sep);
            const parentDir = file.path.substring(0, lastSepIdx);
            const dest = await findCopyName(parentDir, file.name, sep);
            await TauriAPI.acceleratedCopyFile(file.path, dest);
            emitFileActivityRef.current('create', dest);
            duplicated++;
          } catch (error) {
            toastRef.current({
              title: 'Duplicate failed',
              description: `Failed to duplicate "${file.name}": ${formatError(error)}`,
              variant: 'destructive',
            });
          }
        }
        if (duplicated > 0) {
          emitFilesChangedRef.current();
          toastRef.current({
            title: 'Duplicated',
            description: `Duplicated ${duplicated} item${duplicated > 1 ? 's' : ''}`,
          });
        }
      },
      copyName: (file: FileEntry) => {
        navigator.clipboard.writeText(file.name);
        toastRef.current({
          title: tRef.current('toast.nameCopied'),
          description: tRef.current('toast.nameCopiedDesc', { name: file.name }),
        });
      },
      pinToSidebar: async (file: FileEntry) => {
        try {
          await TauriAPI.addBookmark(file.path, file.name);
          window.dispatchEvent(new CustomEvent('bookmarks-changed'));
          toastRef.current({
            title: tRef.current('toast.pinnedToSidebar'),
            description: tRef.current('toast.pinnedToSidebarDesc', { name: file.name }),
          });
        } catch (error) {
          toastRef.current({
            title: tRef.current('toast.pinFailed'),
            description: tRef.current('toast.pinFailedDesc', {
              name: file.name,
              error: formatError(error),
            }),
            variant: 'destructive',
          });
        }
      },
      createNewTextFile: async (parentPath: string) => {
        try {
          const defaultName = tRef.current('fileOperations.newTextFileName');
          const filePath = await findUniqueFilePath(parentPath, defaultName, '.txt');
          await TauriAPI.createFile(filePath);
          const name = filePath.split(/[/\\]/).pop() || `${defaultName}.txt`;
          emitFileActivityRef.current('create', filePath, name);
          emitFilesChangedRef.current();
          toastRef.current({
            title: tRef.current('toast.fileCreated'),
            description: tRef.current('toast.fileCreatedDesc', { name }),
          });
        } catch (error) {
          toastRef.current({
            title: tRef.current('toast.createFileFailed'),
            description: tRef.current('toast.createFileFailedDesc', { error: formatError(error) }),
            variant: 'destructive',
          });
        }
      },
      createNewFile: async (parentPath: string) => {
        const fileName = await showInputToast({
          title: tRef.current('fileOperations.newFileTitle'),
          description: tRef.current('fileOperations.newFileDescription'),
          placeholder: tRef.current('fileOperations.fileNamePlaceholder'),
          validate: (value) =>
            getFileNameValidationError(
              value,
              filesRef.current.map((entry) => entry.name),
              '',
              tRef.current,
            ),
          submitText: tRef.current('fileOperations.createAction'),
          cancelText: tRef.current('common.cancel'),
        });
        if (fileName) {
          try {
            const sep = detectSep(parentPath);
            const filePath = `${parentPath}${parentPath.endsWith(sep) ? '' : sep}${fileName}`;
            await TauriAPI.createFile(filePath);
            emitFileActivityRef.current('create', filePath, fileName);
            emitFilesChangedRef.current();
            toastRef.current({
              title: tRef.current('toast.fileCreated'),
              description: tRef.current('toast.fileCreatedDesc', { name: fileName }),
            });
          } catch (error) {
            toastRef.current({
              title: tRef.current('toast.createFileFailed'),
              description: tRef.current('toast.createFileFailedDesc', {
                error: formatError(error),
              }),
              variant: 'destructive',
            });
          }
        }
      },
      openTemplatePicker: (_parentPath: string) => {
        dialogsRef.current.openTemplatePicker();
      },
      pasteFromHistory: (targetPath: string, entry: ClipboardEntry) => {
        const fileEntries: FileEntry[] = entry.files.map((f) => ({
          path: f.path,
          name: f.name,
          size: 0,
          modified: 0,
          is_dir: f.isDir,
          file_type: f.isDir ? 'folder' : f.name.split('.').pop() || '',
          is_readonly: false,
        }));
        setClipboardBothRef.current({ files: fileEntries, operation: entry.operation });
        contextMenuFactoryRef.current.updateClipboard(fileEntries, entry.operation);
        queueMicrotask(() => {
          contextMenuActions.paste(targetPath);
        });
      },
      createSymlink: (file: FileEntry) => {
        dialogsRef.current.openSymlinkDialog(file.path);
      },
      openPasteRename: (files: FileEntry[]) => {
        dialogsRef.current.openPasteRenameDialog(files);
      },
      openBatchMetadata: (files: FileEntry[]) => {
        dialogsRef.current.openBatchMetadataDialog(files);
      },
      compareFolders: (leftPath: string, rightPath: string) => {
        dialogsRef.current.openFolderCompare(leftPath, rightPath);
      },
      setViewMode: (mode: string) => {
        setViewModeRef.current(mode);
      },
      setSortBy: (field: SortField) => {
        setSortByRef.current(field);
      },
      setSortOrder: (order: 'asc' | 'desc') => {
        setSortOrderRef.current(order);
      },
      lockFile: async (file: FileEntry) => {
        try {
          // Unix: 444 (read-only for owner/group/others), Windows: 'readonly'
          const permissions = /^[a-zA-Z]:\\/.test(file.path) ? 'readonly' : '444';
          await TauriAPI.setFilePermissions(file.path, permissions);
          emitFilesChangedRef.current();
          toastRef.current({
            title: 'File locked',
            description: `"${file.name}" is now read-only`,
          });
        } catch (error) {
          toastRef.current({
            title: 'Lock failed',
            description: `Failed to lock "${file.name}": ${formatError(error)}`,
            variant: 'destructive',
          });
        }
      },
      unlockFile: async (file: FileEntry) => {
        try {
          // Unix: 644 (owner can write, group/others read), Windows: 'writable'
          const permissions = /^[a-zA-Z]:\\/.test(file.path) ? 'writable' : '644';
          await TauriAPI.setFilePermissions(file.path, permissions);
          emitFilesChangedRef.current();
          toastRef.current({
            title: 'File unlocked',
            description: `"${file.name}" is now writable`,
          });
        } catch (error) {
          toastRef.current({
            title: 'Unlock failed',
            description: `Failed to unlock "${file.name}": ${formatError(error)}`,
            variant: 'destructive',
          });
        }
      },
    }),
    [],
  );

  // ── Context menu factory ───────────────────────────────────────────────

  const contextMenuFactoryRef = useRef<ContextMenuFactory>(null!);
  const contextMenuFactory = useMemo(
    () =>
      new ContextMenuFactory(contextMenuActions, {
        showHidden: false,
        enableCompression: true,
        enableAdvanced: true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  contextMenuFactoryRef.current = contextMenuFactory;

  // ── Standalone operation handlers (used by OperationBar, shortcuts, etc.) ──

  const handleDelete = useCallback(async () => {
    if (selectedFiles.size === 0) return;

    const doDelete = async () => {
      try {
        for (const filePath of Array.from(selectedFiles)) {
          await TauriAPI.moveToTrash(filePath);
          emitFileActivity('remove', filePath);
        }
        setSelectedFiles(new Set());
        emitFilesChanged();
        toast({
          title: t('toast.movedToTrash'),
          description: t('toast.movedToTrashDesc', { count: selectedFiles.size }),
        });
      } catch (error) {
        console.error('Failed to move files to trash:', error);
        toast({
          variant: 'destructive',
          title: t('toast.moveToTrashFailed'),
          description: t('toast.moveToTrashFailedDesc', { error: formatError(error) }),
        });
      }
    };

    if (selectedFiles.size > 1) {
      const selectedEntries = resolveSelectedFiles(selectedFiles, files);
      dialogs.openBatchConfirmDialog('delete', selectedEntries, doDelete);
    } else {
      const confirmed = await showConfirmationToast({
        title: t('fileOperations.moveToTrashTitle'),
        description: t('fileOperations.moveToTrashSelectedPrompt', { count: 1 }),
        confirmText: t('fileOperations.moveToTrashConfirm'),
        cancelText: t('common.cancel'),
      });
      if (confirmed) await doDelete();
    }
  }, [
    selectedFiles,
    setSelectedFiles,
    files,
    emitFilesChanged,
    emitFileActivity,
    toast,
    dialogs,
    t,
  ]);

  const handleCreateFolder = useCallback(async () => {
    const folderName = await showInputToast({
      title: t('fileOperations.newFolderTitle'),
      description: t('fileOperations.newFolderDescription'),
      placeholder: t('fileOperations.folderNamePlaceholder'),
      validate: (value) =>
        getFileNameValidationError(
          value,
          files.map((entry) => entry.name),
          '',
          t,
        ),
      submitText: t('fileOperations.createAction'),
      cancelText: t('common.cancel'),
    });
    if (!folderName) return;
    try {
      const newFolderPath =
        currentPath + (currentPath.endsWith(PATH_SEPARATOR) ? '' : PATH_SEPARATOR) + folderName;
      await TauriAPI.createDirRecursive(newFolderPath);
      emitFileActivity('create', newFolderPath, folderName);
      emitFilesChanged();
      toast({
        title: t('toast.folderCreated'),
        description: t('toast.folderCreatedDesc', { name: folderName }),
      });
    } catch (error) {
      console.error('Failed to create folder:', error);
      toast({
        variant: 'destructive',
        title: t('toast.createFolderFailed'),
        description: t('toast.createFolderFailedDesc', { error: formatError(error) }),
      });
    }
  }, [currentPath, files, emitFileActivity, emitFilesChanged, toast, t]);

  // ── Shortcut clipboard handlers ────────────────────────────────────────

  const copySelectedFiles = useCallback(() => {
    const selected = resolveSelectedFiles(selectedFiles, files);
    if (selected.length > 0) {
      setClipboardEntries(
        selected,
        'copy',
        setClipboardBoth,
        (f, op) => contextMenuFactoryRef.current.updateClipboard(f, op),
        toast,
      );
      mirrorCopyToSystemClipboard(selected);
    }
  }, [selectedFiles, files, toast, setClipboardBoth]);

  const cutSelectedFiles = useCallback(() => {
    const selected = resolveSelectedFiles(selectedFiles, files);
    if (selected.length > 0) {
      setClipboardEntries(
        selected,
        'cut',
        setClipboardBoth,
        (f, op) => contextMenuFactoryRef.current.updateClipboard(f, op),
        toast,
      );
    }
  }, [selectedFiles, files, toast, setClipboardBoth]);

  const pasteFiles = useCallback(async () => {
    const cb = clipboardRef.current;
    if (!cb || cb.files.length === 0) return;
    await runPaste(cb, currentPath);
  }, [currentPath, runPaste]);

  // Finder's ⌥⌘V: paste the clipboard as a move even if it was copied
  const pasteFilesAsMove = useCallback(async () => {
    const cb = clipboardRef.current;
    if (!cb || cb.files.length === 0) return;
    await runPaste({ ...cb, operation: 'cut' }, currentPath);
  }, [currentPath, runPaste]);

  const deleteSelectedFiles = useCallback(async () => {
    const selectedFilesArray = Array.from(selectedFiles);
    if (selectedFilesArray.length > 0) {
      try {
        for (const filePath of selectedFilesArray) {
          await TauriAPI.moveToTrash(filePath);
          emitFileActivity('remove', filePath);
        }
        toastRef.current({
          title: t('fileOperations.movedToTrashTitle'),
          description: t('fileOperations.movedToTrashDesc', {
            count: selectedFilesArray.length,
          }),
        });
        setSelectedFiles(new Set());
        emitFilesChanged();
      } catch (error) {
        toastRef.current({
          title: t('fileOperations.deleteFailedTitle'),
          description: t('fileOperations.deleteFailedDesc', { error: formatError(error) }),
          variant: 'destructive',
        });
      }
    }
  }, [selectedFiles, setSelectedFiles, emitFileActivity, emitFilesChanged, t]);

  const createFileFromTemplate = useCallback(
    async (filename: string, content: string) => {
      try {
        const sep = detectSep(currentPath);
        const filePath = `${currentPath}${currentPath.endsWith(sep) ? '' : sep}${filename}`;
        await TauriAPI.createFileWithContent(filePath, content);
        emitFileActivity('create', filePath, filename);
        emitFilesChanged();
        toast({
          title: t('toast.fileCreated'),
          description: t('toast.fileFromTemplateDesc', { name: filename }),
        });
      } catch (error) {
        console.error('Failed to create file from template:', error);
        toast({
          title: t('toast.createFileFailed'),
          description: t('toast.createFileFailedDesc', { error: formatError(error) }),
          variant: 'destructive',
        });
      }
    },
    [currentPath, emitFileActivity, emitFilesChanged, toast, t],
  );

  const renameFileInline = useCallback(
    async (oldPath: string, newName: string): Promise<boolean> => {
      try {
        const sep = detectSep(oldPath);
        const lastSepIdx = oldPath.lastIndexOf(sep);
        const parentDir = oldPath.substring(0, lastSepIdx);
        const oldName = oldPath.substring(lastSepIdx + 1);

        // Finder asks before an inline rename changes a file's extension.
        // 'keep-old' rewrites the typed name to carry the original extension.
        const entry = filesRef.current.find((f) => f.path === oldPath);
        const confirmExtensionChange = confirmExtensionChangeRef.current;
        if (entry && !entry.is_dir && confirmExtensionChange) {
          const oldExt = getExtension(oldName);
          const newExt = getExtension(newName);
          if (oldExt.toLowerCase() !== newExt.toLowerCase()) {
            const choice = await confirmExtensionChange(oldName, oldExt, newExt);
            if (choice === 'keep-old') {
              const kept = stripExtension(newName) + (oldExt ? `.${oldExt}` : '');
              if (kept === oldName) return true; // rewrite landed on the old name
              newName = kept;
            }
          }
        }

        const newPath = `${parentDir}${sep}${newName}`;
        await TauriAPI.rename(oldPath, newPath);
        emitFileActivity('file-renamed', newPath, newName, oldPath);
        emitFilesChanged();
        toast({
          title: t('toast.renamed'),
          description: t('toast.renamedInlineDesc', { oldName, newName }),
        });
        return true;
      } catch (error) {
        console.error('Inline rename failed:', error);
        toast({
          variant: 'destructive',
          title: t('toast.renameFailed'),
          description: t('toast.renameFailedDesc', { error: formatError(error) }),
        });
        return false;
      }
    },
    [emitFilesChanged, emitFileActivity, toast, t],
  );

  return {
    clipboard,
    setClipboard,
    contextMenuActions,
    contextMenuFactory,
    contextMenuFactoryRef,
    handleDelete,
    handleCreateFolder,
    copySelectedFiles,
    cutSelectedFiles,
    pasteFiles,
    pasteFilesAsMove,
    deleteSelectedFiles,
    createFileFromTemplate,
    renameFileInline,
    formatError,
  };
};
