import { getAppLocale } from '@/lib/locale';
import React from 'react';
import i18n from '@/i18n';
import { FileEntry, TauriAPI } from '@/lib/tauri-api';
import { ContextMenuItem } from '@/components/ui/ContextMenu';
import { PATH_SEPARATOR, isMac } from '@/lib/constants';
import { readHiddenFilesVisible, toggleHiddenFilesState } from '@/hooks/use-hidden-files';
import { isEditableFile } from '@/lib/editable-files';
import { extensionHost } from '@/lib/extension-host';
import { getRecentEntries, type ClipboardEntry } from '@/hooks/use-clipboard-history';
import type { SortField } from '@/lib/utils';
import { shouldShowMenuItem } from '@/lib/context-menu-rules';
import {
  getCachedFileTags,
  toggleTagOnFile,
  getTagPalette,
  ensureTagPalette,
} from '@/lib/file-tags-cache';
import { displayTagName } from '@/lib/finder-tags';
import {
  FolderOpen,
  ExternalLink,
  Wrench,
  Bot,
  Copy,
  Scissors,
  Clipboard,
  Pencil,
  PencilLine,
  Trash2,
  Package,
  Scale,
  Bookmark,
  BarChart3,
  MapPin,
  Terminal,
  Tag,
  StickyNote,
  MessageSquare,
  Database,
  Settings,
  Eye,
  EyeOff,
  LayoutGrid,
  Grid3X3,
  Grid2X2,
  List,
  Table,
  ArrowUpDown,
  ArrowDownAZ,
  ArrowUpAZ,
  Calendar,
  HardDrive,
  RefreshCw,
  Plus,
  FolderClosed,
  FolderPlus,
  FileText,
  CheckSquare,
  RotateCcw,
  Lock,
  Unlock,
  ShieldAlert,
  CopyPlus,
  ClipboardCopy,
  Pin,
  FilePlus2,
  ClipboardList,
  Link2,
  FileCode2,
  Palette,
  FolderSync,
  MoreHorizontal,
  Fingerprint,
  CloudDownload,
  type LucideIcon,
} from 'lucide-react';
import {
  FOLDER_COLORS,
  colorName,
  getFolderColor,
  setFolderColor,
  removeFolderColor,
} from '@/lib/folder-colors';
export type { ContextMenuItem } from '@/components/ui/ContextMenu';

// Helper to create a context menu icon element
const mi = (Icon: LucideIcon): React.ReactNode =>
  React.createElement(Icon, { size: 14, className: 'inline-block' });

export interface ContextMenuAction {
  openInNewTab: (file: FileEntry) => void;
  openFile: (file: FileEntry) => void;
  copy: (files: FileEntry[]) => void;
  cut: (files: FileEntry[]) => void;
  paste: (targetPath: string) => void;
  delete: (files: FileEntry[]) => void;
  rename: (file: FileEntry) => void;
  createFolder: (parentPath: string) => void;
  createFile: (parentPath: string) => void;
  properties: (file: FileEntry | FileEntry[]) => void;
  refresh: () => void;
  selectAll: () => void;
  invertSelection: () => void;
  openAdvancedSelection: () => void;
  copyPath: (files: FileEntry | FileEntry[]) => void;
  openInTerminal: (path: string) => void;
  openRecycleBin: () => void;
  openWith: (file: FileEntry) => void;
  compressTo: (files: FileEntry[]) => void;
  extractHere: (file: FileEntry) => void;
  compareFiles: (file1: FileEntry, file2?: FileEntry) => void;
  markForComparison: (file: FileEntry) => void;
  bulkRename: (files: FileEntry[]) => void;
  manageTags: (file: FileEntry) => void;
  openFileDetails: (file: FileEntry, tab?: 'notes' | 'annotations' | 'metadata') => void;
  calculateFolderSize?: (file: FileEntry) => void;
  openInEditor: (file: FileEntry) => void;
  encryptFile: (file: FileEntry) => void;
  decryptFile: (file: FileEntry) => void;
  secureDelete: (files: FileEntry[]) => void;
  duplicateFiles: (files: FileEntry[]) => void;
  copyName: (files: FileEntry | FileEntry[]) => void;
  pinToSidebar: (file: FileEntry) => void;
  createNewTextFile: (parentPath: string) => void;
  createNewFile: (parentPath: string) => void;
  openTemplatePicker: (parentPath: string) => void;
  pasteFromHistory?: (targetPath: string, entry: ClipboardEntry) => void;
  createSymlink: (file: FileEntry) => void;
  openPasteRename: (files: FileEntry[]) => void;
  openBatchMetadata?: (files: FileEntry[]) => void;
  compareFolders?: (leftPath: string, rightPath: string) => void;
  setViewMode: (mode: string) => void;
  setSortBy: (field: SortField) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  lockFile?: (file: FileEntry) => void;
  unlockFile?: (file: FileEntry) => void;
  /** #26: Finder's 「立即下载」 — materialize an iCloud placeholder. */
  downloadNow?: (file: FileEntry) => void;
  /** #12: 快速查看 — the same preview channel the space key uses. */
  quickLook?: (file: FileEntry) => void;
  /** #20: 显示原身 — reveal a symlink/alias target in its parent folder. */
  showOriginal?: (file: FileEntry) => void;
  /** #28/#37/#47: 用所选项目新建文件夹 — new folder, selection moved inside. */
  newFolderFromSelection?: (files: FileEntry[], parentPath: string) => void;
  /** #62: 立即删除 — delete permanently, bypassing the trash. */
  deleteImmediately?: (files: FileEntry[]) => void;
}

export interface ContextMenuConfig {
  resolveFile?: (path: string) => FileEntry | undefined;
  showHidden?: boolean;
  enableCompression?: boolean;
  enableAdvanced?: boolean;
  customActions?: ContextMenuItem[];
}

/** #41: .app bundles walk the folder code paths; Finder collapses them to app items. */
const isAppBundle = (file: FileEntry): boolean => file.is_dir && /\.app$/i.test(file.path);

/** #8: Finder refuses to re-wrap an already-compressed archive or disk image. */
const UNCOMPRESSABLE_PATTERN =
  /\.(zip|rar|7z|tar|gz|bz2|xz|tgz|tbz2|txz|dmg|iso|img|sparseimage|sparsebundle)$/i;

/** #44: Finder dims 压缩 for volume roots — zipping a whole volume is a footgun. */
const isVolumeRoot = (path: string): boolean => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === '' || normalized === '/') return true;
  const parts = normalized.split('/');
  if (parts.length === 3 && parts[1] === 'Volumes') return true; // /Volumes/Name
  return parts.length === 1 && /^[A-Za-z]:$/.test(parts[0]); // drive root (C:)
};

/** Parent directory of a path, never empty (roots resolve to the separator). */
const parentDirectoryOf = (path: string): string =>
  path.split(/[\\/]/).slice(0, -1).join(PATH_SEPARATOR) || PATH_SEPARATOR;

/** Build a minimal FileEntry from a path string (for multi-select operations). */
const entryFromPath = (path: string): FileEntry => {
  const name = path.split(/[/\\]/).pop() || path;
  const dotIdx = name.lastIndexOf('.');
  const extension = dotIdx > 0 ? name.slice(dotIdx + 1) : '';
  return {
    path,
    name,
    size: 0,
    modified: 0,
    is_dir: !extension,
    file_type: extension || 'folder',
    is_readonly: false,
  };
};

export class ContextMenuFactory {
  private actions: ContextMenuAction;
  private config: ContextMenuConfig;
  private clipboard: { files: FileEntry[]; operation: 'copy' | 'cut' } | null = null;
  private markedForComparison: FileEntry | null = null;

  constructor(actions: ContextMenuAction, config: ContextMenuConfig = {}) {
    this.actions = actions;
    this.config = {
      showHidden: false,
      enableCompression: true,
      enableAdvanced: true,
      ...config,
    };
  }

  // Update clipboard state
  updateClipboard(files: FileEntry[], operation: 'copy' | 'cut') {
    this.clipboard = { files, operation };
  }

  // Clear clipboard state
  clearClipboard() {
    this.clipboard = null;
  }

  // Update marked for comparison state
  markFileForComparison(file: FileEntry) {
    this.markedForComparison = file;
  }

  // Clear marked for comparison state
  clearComparisonMark() {
    this.markedForComparison = null;
  }

  /**
   * Resolve the entries a right-click acts on: the clicked file alone, or the
   * whole selection when the click landed inside it. Used by use-context-menu
   * to route multi-target actions (打开方式) without rebuilding the menu.
   */
  getSelectionEntries(file: FileEntry, selectedFiles: Set<string>): FileEntry[] {
    const inSelection = selectedFiles.has(file.path) && selectedFiles.size > 1;
    if (!inSelection) return [file];
    return Array.from(selectedFiles).map((path) =>
      path === file.path ? file : (this.config.resolveFile?.(path) ?? entryFromPath(path)),
    );
  }

  // Get marked file for comparison
  getMarkedFile(): FileEntry | null {
    return this.markedForComparison;
  }

  // Build "Paste Recent" submenu items from clipboard history
  private buildPasteRecentSubmenu(targetPath: string): ContextMenuItem | null {
    const recent = getRecentEntries(5);
    if (recent.length === 0) return null;

    const formatTime = (ts: number): string => {
      const diff = Date.now() - ts;
      if (diff < 60_000) return 'just now';
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
      return new Date(ts).toLocaleTimeString(getAppLocale(), {
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const submenu: ContextMenuItem[] = recent.map((entry) => {
      const names =
        entry.files.length === 1
          ? entry.files[0].name
          : `${entry.files[0].name} +${entry.files.length - 1}`;
      const prefix = entry.operation === 'cut' ? 'Cut' : 'Copied';
      const label = `${prefix}: ${names} (${formatTime(entry.timestamp)})`;
      return {
        id: `paste-history-${entry.id}`,
        label,
        icon: entry.operation === 'cut' ? mi(Scissors) : mi(Copy),
        action: () => {
          if (this.actions.pasteFromHistory) {
            this.actions.pasteFromHistory(targetPath, entry);
          }
        },
      };
    });

    return {
      id: 'paste-recent',
      label: i18n.t('contextMenu.pasteRecent'),
      icon: mi(ClipboardList),
      submenu,
    };
  }

  // Get context menu items for a file/folder
  getFileContextMenu(
    file: FileEntry,
    selectedFiles: Set<string>,
    clipboard?: { files: FileEntry[]; operation: 'copy' | 'cut' } | null,
  ): ContextMenuItem[] {
    // Use provided clipboard or fallback to internal clipboard
    const currentClipboard = clipboard !== undefined ? clipboard : this.clipboard;
    // A right-click outside the selection targets that item, not an old batch.
    selectedFiles = selectedFiles.has(file.path) ? selectedFiles : new Set([file.path]);
    const isMultiSelect = selectedFiles.size > 1;
    const selectedFilesList = Array.from(selectedFiles);
    const resolveEntry = (path: string) =>
      path === file.path ? file : (this.config.resolveFile?.(path) ?? entryFromPath(path));
    // The entries the menu acts on: the right-clicked file alone, or the whole
    // selection when the click landed inside it.
    const selectionEntries = isMultiSelect ? selectedFilesList.map(resolveEntry) : [file];

    const items: ContextMenuItem[] = [];

    // ── Finder-aligned main section ────────────────────────────────────────
    // 名称/顺序/插值照 Finder 实测规格（§1 单选文件为基准序）：打开 ▸ 打开方式▸
    // ▸ 快速查看 ▸ 显示简介 ‖ 移到废纸篓 ‖ 重新命名 ▸ 压缩“名字” ▸ 拷贝 ▸ 粘贴
    // ‖ 标签…。Finder 没有的 Wisp 独有能力统一收纳到尾部独立分区（见下方）。

    // Open actions
    if (isMultiSelect) {
      items.push({
        id: 'open',
        // #33: Finder counts the batch — 「打开 N 个项目」
        label: i18n.t('contextMenu.openItems', { count: selectedFiles.size }),
        icon: mi(FolderOpen),
        action: () => {
          for (const entry of selectionEntries) {
            if (entry.is_dir) this.actions.openInNewTab(entry);
            else this.actions.openFile(entry);
          }
        },
      });
    } else {
      items.push({
        id: 'open',
        label: i18n.t('contextMenu.open'),
        icon: mi(FolderOpen),
        action: () => this.actions.openFile(file),
      });

      // #26: Finder offers 立即下载 right after Open for dataless iCloud
      // placeholders; resident files never see it.
      if (file.is_cloud_placeholder === true) {
        items.push({
          id: 'download-now',
          label: i18n.t('contextMenu.downloadNow'),
          icon: mi(CloudDownload),
          action: () => this.actions.downloadNow?.(file),
        });
      }
    }

    // 打开方式 ▸ — Finder keeps it enabled for a multi-selection of files
    // (spec S3). The app list is attached asynchronously by use-context-menu
    // (get_file_associations); until it lands the submenu shows a loading row
    // plus 其他….
    if (selectionEntries.every((entry) => !entry.is_dir)) {
      items.push({
        id: 'open-with',
        label: i18n.t('contextMenu.openWith'),
        icon: mi(Wrench),
        submenu: [
          { id: 'open-with-loading', label: i18n.t('contextMenu.loadingApps'), disabled: true },
          { id: 'open-with-sep-load', label: '', separator: true },
          {
            id: 'open-with-other',
            label: i18n.t('contextMenu.openWithOther'),
            action: () => this.actions.openWith(file),
          },
        ],
      });
    }

    // #20: Finder's 显示原身 — jump to what a link points at. Symlink targets
    // ship on FileEntry; alias resolution has no backend channel yet, so an
    // alias shows the item dimmed with a hint instead of a dead action.
    if (!isMultiSelect && (file.is_symlink || file.is_alias)) {
      const hasTarget = typeof file.symlink_target === 'string' && file.symlink_target.length > 0;
      items.push({
        id: 'show-original',
        label: i18n.t('contextMenu.showOriginal'),
        disabled: !hasTarget,
        disabledReason: hasTarget ? undefined : i18n.t('contextMenu.showOriginalUnavailable'),
        action: () => {
          if (hasTarget) this.actions.showOriginal?.(file);
        },
      });
    }

    // .app bundle：Finder 同款——「显示包内容」进包浏览（.app 在文件系统层
    // 是目录，双击已特判为启动应用，浏览包内容只能从这里进）。
    if (!isMultiSelect && isAppBundle(file)) {
      items.push({
        id: 'show-package-contents',
        label: i18n.t('contextMenu.showPackageContents'),
        action: () => this.actions.openInNewTab(file),
      });
    }

    // #12: 快速查看 — same channel as the space key, now discoverable.
    // Multi-item 快速查看 goes to the gallery — Wisp's gallery view is its
    // multi-preview surface and keeps the selection live.
    items.push({
      id: 'quick-look',
      label: i18n.t('contextMenu.quickLook'),
      icon: mi(Eye),
      shortcut: 'Space',
      action: isMultiSelect
        ? () => this.actions.setViewMode('gallery')
        : () => this.actions.quickLook?.(file),
    });

    // #37: Finder's 用所选项目新建文件夹 rides right after the open group.
    if (isMultiSelect) {
      items.push({
        id: 'new-folder-from-selection',
        label: i18n.t('contextMenu.newFolderFromSelectionItems', {
          count: selectedFiles.size,
        }),
        icon: mi(FolderPlus),
        action: () => {
          this.actions.newFolderFromSelection?.(selectionEntries, parentDirectoryOf(file.path));
        },
      });
    }

    // 显示简介 (⌘I)
    items.push({
      id: 'properties',
      label: i18n.t('common.properties'),
      icon: mi(Settings),
      shortcut: 'Ctrl+I',
      action: () => this.actions.properties(isMultiSelect ? selectionEntries : file),
    });

    items.push({ id: 'sep-trash', label: '', separator: true });

    // 移到废纸篓
    items.push({
      id: 'delete',
      label: isMultiSelect
        ? i18n.t('contextMenu.deleteItems', { count: selectedFiles.size })
        : i18n.t('contextMenu.delete'),
      icon: mi(Trash2),
      shortcut: 'Ctrl+Backspace',
      action: () => this.actions.delete(selectionEntries),
    });

    items.push({ id: 'sep-file-actions', label: '', separator: true });

    // 重新命名（Finder：多选时为「重新命名…」）
    if (!isMultiSelect) {
      items.push({
        id: 'rename',
        label: i18n.t('contextMenu.rename'),
        icon: mi(Pencil),
        shortcut: 'Enter',
        action: () => this.actions.rename(file),
      });
    } else {
      items.push({
        id: 'bulk-rename',
        label: i18n.t('contextMenu.bulkRename'),
        icon: mi(PencilLine),
        action: () => this.actions.bulkRename(selectionEntries),
      });
    }

    // 压缩 — Finder 一级项：单选「压缩“名字”」，多选「压缩 N 个项目」。
    // #8/#44: Finder dims 压缩 instead of hiding it for archives, disk
    // images and volume roots — the disabled item teaches the rule. A
    // multi-selection can always be compressed (Finder semantics).
    const canExtract =
      !isMultiSelect &&
      !file.is_dir &&
      /\.(zip|rar|7z|tar|gz|bz2|xz|tgz|tbz2|txz)$/i.test(file.name);
    if (this.config.enableCompression) {
      const compressBlocked =
        !isMultiSelect &&
        ((!file.is_dir && UNCOMPRESSABLE_PATTERN.test(file.name)) ||
          (file.is_dir && isVolumeRoot(file.path)));
      const compressBlockedReason = file.is_dir
        ? i18n.t('contextMenu.compressVolumeBlocked')
        : i18n.t('contextMenu.compressAlreadyArchived');
      items.push({
        id: 'compress',
        label: isMultiSelect
          ? i18n.t('contextMenu.compressItems', { count: selectedFiles.size })
          : i18n.t('contextMenu.addToArchive', { name: file.name }),
        icon: mi(Package),
        disabled: compressBlocked,
        disabledReason: compressBlocked ? compressBlockedReason : undefined,
        action: () => this.actions.compressTo(selectionEntries),
      });
    }

    // 拷贝 (⌘C) — Finder 用「拷贝」不是「复制」
    items.push({
      id: 'copy',
      label: isMultiSelect
        ? i18n.t('contextMenu.copyItems', { count: selectedFiles.size })
        : i18n.t('contextMenu.copy'),
      icon: mi(Copy),
      shortcut: 'Ctrl+C',
      action: () => {
        this.actions.copy(selectionEntries);
        this.updateClipboard(selectionEntries, 'copy');
      },
    });

    items.push({
      id: 'paste',
      label: i18n.t('contextMenu.paste'),
      icon: mi(Clipboard),
      shortcut: 'Ctrl+V',
      disabled: !currentClipboard || currentClipboard.files.length === 0,
      action: () => {
        const targetPath = file.is_dir
          ? file.path
          : file.path.split(/[\\/]/).slice(0, -1).join(PATH_SEPARATOR);
        this.actions.paste(targetPath);
      },
    });

    // 将“名字”拷贝为路径名称 (⌥⌘C)；多选用普通「拷贝路径」
    items.push({
      id: 'copy-path',
      label: isMultiSelect
        ? i18n.t('contextMenu.copyPath')
        : i18n.t('contextMenu.copyPathName', { name: file.name }),
      icon: mi(MapPin),
      shortcut: 'Ctrl+Alt+C',
      action: () => this.actions.copyPath(isMultiSelect ? selectionEntries : file),
    });

    items.push({ id: 'sep-tags', label: '', separator: true });

    // --- Wisp-unique trailing section ─────────────────────────────────────
    // Finder 没有的能力收纳到菜单尾部独立分区（一条分隔线后），互序保持现状。
    const wispUniqueItems: ContextMenuItem[] = [];

    // --- "More" submenu: less-common actions grouped together ---
    const moreItems: ContextMenuItem[] = [];

    // Create Link (single item only)
    if (!isMultiSelect) {
      wispUniqueItems.push({
        id: 'create-symlink',
        label: i18n.t('contextMenu.createLink'),
        icon: mi(Link2),
        action: () => this.actions.createSymlink(file),
      });
    }

    // AI ▸ quick actions — summon the chat panel with a prefilled prompt.
    // First version sends as a folder-anchored conversation; the user can
    // edit the prompt before pressing Enter.
    // #41: .app bundles collapse the folder-flavored extras; a bundle only
    // offers organize here, which reads wrong on an application.
    if (!isMultiSelect && !isAppBundle(file)) {
      const ask = (template: string) =>
        window.dispatchEvent(new CustomEvent('wisp-open-chat', { detail: { prompt: template } }));
      wispUniqueItems.push({
        id: 'ai-actions',
        label: i18n.t('contextMenu.aiActions'),
        icon: mi(Bot),
        submenu: [
          ...(file.is_dir
            ? [
                {
                  id: 'ai-organize',
                  label: i18n.t('contextMenu.aiOrganize'),
                  action: () => ask(i18n.t('contextMenu.aiOrganizePrompt', { name: file.name })),
                },
              ]
            : [
                {
                  id: 'ai-summarize',
                  label: i18n.t('contextMenu.aiSummarize'),
                  action: () => ask(i18n.t('contextMenu.aiSummarizePrompt', { name: file.name })),
                },
                {
                  id: 'ai-explain',
                  label: i18n.t('contextMenu.aiExplain'),
                  action: () => ask(i18n.t('contextMenu.aiExplainPrompt', { name: file.name })),
                },
                {
                  id: 'ai-rename',
                  label: i18n.t('contextMenu.aiRename'),
                  action: () => ask(i18n.t('contextMenu.aiRenamePrompt', { name: file.name })),
                },
              ]),
        ],
      });
    }

    // Secure Delete
    moreItems.push({
      id: 'secure-delete',
      label: isMultiSelect
        ? i18n.t('contextMenu.secureDeleteItems', { count: selectedFiles.size })
        : i18n.t('contextMenu.secureDelete'),
      icon: mi(ShieldAlert),
      action: () => {
        const filesToSecureDelete = isMultiSelect ? selectedFilesList.map(resolveEntry) : [file];
        this.actions.secureDelete(filesToSecureDelete);
      },
    });

    // Encrypt / Decrypt (single file only, not directories)
    if (!isMultiSelect && !file.is_dir) {
      const isEnc = /\.enc$/i.test(file.name);
      if (isEnc) {
        moreItems.push({
          id: 'decrypt',
          label: i18n.t('contextMenu.decrypt'),
          icon: mi(Unlock),
          action: () => this.actions.decryptFile(file),
        });
      } else {
        moreItems.push({
          id: 'encrypt',
          label: i18n.t('contextMenu.encrypt'),
          icon: mi(Lock),
          action: () => this.actions.encryptFile(file),
        });
      }
    }

    // Lock / Unlock (single select only — sets read-only attribute)
    if (!isMultiSelect && (this.actions.lockFile || this.actions.unlockFile)) {
      if (file.is_readonly) {
        if (this.actions.unlockFile) {
          moreItems.push({
            id: 'unlock-file',
            label: i18n.t('contextMenu.unlockFile'),
            icon: mi(Unlock),
            action: () => this.actions.unlockFile!(file),
          });
        }
      } else {
        if (this.actions.lockFile) {
          moreItems.push({
            id: 'lock-file',
            label: i18n.t('contextMenu.lockFile'),
            icon: mi(Lock),
            action: () => this.actions.lockFile!(file),
          });
        }
      }
    }

    // Compare submenu (only for files, not directories)
    if (!file.is_dir) {
      const canCompare = selectedFiles.size <= 2;

      if (canCompare) {
        const compareSubmenu: ContextMenuItem[] = [];

        if (selectedFiles.size === 2) {
          compareSubmenu.push({
            id: 'compare-selected',
            label: i18n.t('contextMenu.compareSelected'),
            icon: mi(Scale),
            action: () => {
              const filesList = selectedFilesList.map(resolveEntry);
              this.actions.compareFiles(filesList[0], filesList[1]);
            },
          });
        } else {
          if (this.markedForComparison && this.markedForComparison.path !== file.path) {
            compareSubmenu.push({
              id: 'compare-with-marked',
              label: i18n.t('contextMenu.compareWith', { name: this.markedForComparison.name }),
              icon: mi(Scale),
              action: () => {
                this.actions.compareFiles(file, this.markedForComparison!);
                this.clearComparisonMark();
              },
            });
          }

          compareSubmenu.push({
            id: 'mark-for-comparison',
            label:
              this.markedForComparison?.path === file.path
                ? i18n.t('contextMenu.unmarkForComparison')
                : i18n.t('contextMenu.markForComparison'),
            icon: mi(Bookmark),
            action: () => {
              if (this.markedForComparison?.path === file.path) {
                this.clearComparisonMark();
              } else {
                this.markFileForComparison(file);
                this.actions.markForComparison(file);
              }
            },
          });

          compareSubmenu.push({
            id: 'compare-with-other',
            label: i18n.t('contextMenu.compareWithOther'),
            icon: mi(BarChart3),
            action: () => this.actions.compareFiles(file),
          });
        }

        moreItems.push({
          id: 'compare',
          label: i18n.t('contextMenu.compare'),
          icon: mi(Scale),
          submenu: compareSubmenu,
        });
      }
    }

    // Directory-specific advanced actions (#41: not for .app bundles —
    // terminal/folder-size/folder-compare are folder concepts, not app ones)
    if (this.config.enableAdvanced && file.is_dir && !isAppBundle(file)) {
      moreItems.push({
        id: 'open-terminal',
        label: i18n.t('contextMenu.openInTerminal'),
        icon: mi(Terminal),
        action: () => this.actions.openInTerminal(file.path),
      });

      if (this.actions.calculateFolderSize) {
        moreItems.push({
          id: 'calculate-folder-size',
          label: i18n.t('contextMenu.calculateFolderSize'),
          icon: mi(HardDrive),
          action: () => this.actions.calculateFolderSize!(file),
        });
      }

      // Compare Folders: when 2 dirs selected, or single dir selected
      if (this.actions.compareFolders) {
        if (isMultiSelect && selectedFiles.size === 2) {
          const selectedPaths = selectedFilesList;
          moreItems.push({
            id: 'compare-folders',
            label: i18n.t('contextMenu.compareSelectedFolders'),
            icon: mi(FolderSync),
            action: () => {
              this.actions.compareFolders!(selectedPaths[0], selectedPaths[1]);
            },
          });
        } else if (!isMultiSelect) {
          moreItems.push({
            id: 'compare-folders',
            label: i18n.t('contextMenu.compareFolders'),
            icon: mi(FolderSync),
            action: () => {
              this.actions.compareFolders!(file.path, '');
            },
          });
        }
      }
    }

    // Text clipboard actions work for every selection; paths stay one click away.
    moreItems.push({
      id: 'copy-name',
      label: i18n.t('contextMenu.copyName'),
      icon: mi(ClipboardCopy),
      action: () =>
        this.actions.copyName(isMultiSelect ? selectedFilesList.map(resolveEntry) : file),
    });

    // File Details submenu (single select)
    if (!isMultiSelect) {
      moreItems.push({
        id: 'file-details',
        label: i18n.t('contextMenu.fileDetails'),
        icon: mi(FileText),
        submenu: [
          {
            id: 'details-notes',
            label: i18n.t('contextMenu.notes'),
            icon: mi(StickyNote),
            action: () => this.actions.openFileDetails(file, 'notes'),
          },
          {
            id: 'details-annotations',
            label: i18n.t('contextMenu.annotations'),
            icon: mi(MessageSquare),
            action: () => this.actions.openFileDetails(file, 'annotations'),
          },
          {
            id: 'details-metadata',
            label: i18n.t('contextMenu.metadata'),
            icon: mi(Database),
            action: () => this.actions.openFileDetails(file, 'metadata'),
          },
        ],
      });
    }

    // Tags (Finder-style): first-level submenu toggling the file's
    // Finder-tag metadata, plus an entry to the tag editor. Finder offers
    // 标签… for single and multi selections; palette toggles apply to every
    // selected path.
    {
      ensureTagPalette();
      const palette = getTagPalette();
      const currentTags = getCachedFileTags(file.path);
      const tagSubmenu: ContextMenuItem[] = palette.map((tag) => {
        const active = currentTags.some((x) => x.name === tag.name);
        return {
          id: `tag-${tag.name}`,
          label: displayTagName(tag.name),
          icon: React.createElement('span', {
            style: {
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: tag.color,
              border: '1px solid rgba(255,255,255,0.2)',
              flexShrink: 0,
            },
          }),
          checked: active,
          action: () => {
            const targets = isMultiSelect ? selectedFilesList : [file.path];
            for (const targetPath of targets) {
              toggleTagOnFile(
                targetPath,
                tag,
                (p, tags) => TauriAPI.setFileTags(p, tags),
                (p) => TauriAPI.getFileTags(p),
              );
            }
          },
        };
      });
      tagSubmenu.push({ id: 'tag-sep', label: '', separator: true });
      tagSubmenu.push({
        id: 'manage-tags',
        label: i18n.t('contextMenu.tagsEditor'),
        icon: mi(Tag),
        action: () => this.actions.manageTags(file),
      });
      items.push({
        id: 'tags',
        label: i18n.t('contextMenu.tags'),
        icon: mi(Tag),
        submenu: tagSubmenu,
      });
    }

    // Wisp-unique trailing section (Finder 没有的项，一条分隔线后).
    items.push({ id: 'sep-wisp-unique', label: '', separator: true });

    // 解压到此处 — used to live inside the 压缩 submenu; Finder's right-click
    // has no extract item, so it rides at the head of the unique section.
    if (this.config.enableCompression && canExtract) {
      items.push({
        id: 'extract',
        label: i18n.t('contextMenu.extractHere'),
        icon: mi(FolderOpen),
        action: () => this.actions.extractHere(file),
      });
    }

    // #25: Finder offers 在新标签页中打开 only for directories — and not
    // for .app bundles, whose package view lives in 显示包内容 (#41).
    if (!isMultiSelect && file.is_dir && !isAppBundle(file)) {
      items.push({
        id: 'open-new-tab',
        label: i18n.t('contextMenu.openInNewTab'),
        icon: mi(ExternalLink),
        action: () => this.actions.openInNewTab(file),
      });
    }

    if (!isMultiSelect && !file.is_dir && isEditableFile(file)) {
      items.push({
        id: 'open-in-editor',
        label: i18n.t('contextMenu.edit'),
        icon: mi(Pencil),
        action: () => this.actions.openInEditor(file),
      });
    }

    // 剪切 (⌘X)
    items.push({
      id: 'cut',
      label: isMultiSelect
        ? i18n.t('contextMenu.cutItems', { count: selectedFiles.size })
        : i18n.t('contextMenu.cut'),
      icon: mi(Scissors),
      shortcut: 'Ctrl+X',
      action: () => {
        this.actions.cut(selectionEntries);
        this.updateClipboard(selectionEntries, 'cut');
      },
    });

    // Paste Recent submenu (clipboard history)
    {
      const pasteTarget = file.is_dir
        ? file.path
        : file.path.split(/[\\/]/).slice(0, -1).join(PATH_SEPARATOR);
      const pasteRecentItem = this.buildPasteRecentSubmenu(pasteTarget);
      if (pasteRecentItem) items.push(pasteRecentItem);
    }

    // 创建副本 (⌘D) — Finder's 复制 duplicate-equivalent, Wisp wording.
    items.push({
      id: 'duplicate',
      label: isMultiSelect
        ? i18n.t('contextMenu.duplicateItems', { count: selectedFiles.size })
        : i18n.t('contextMenu.duplicate'),
      icon: mi(CopyPlus),
      shortcut: 'Ctrl+D',
      action: () => this.actions.duplicateFiles(selectionEntries),
    });

    // #62: Finder's 立即删除… — skip the trash entirely. The red state plus
    // the confirm dialog live in the action layer; 移到废纸篓 stays reversible.
    items.push({
      id: 'delete-immediately',
      label: isMultiSelect
        ? i18n.t('contextMenu.deleteImmediatelyItems', { count: selectedFiles.size })
        : i18n.t('contextMenu.deleteImmediately'),
      icon: mi(Trash2),
      danger: true,
      action: () => this.actions.deleteImmediately?.(selectionEntries),
    });

    // 粘贴并重命名（多选独有）
    if (isMultiSelect) {
      items.push({
        id: 'paste-rename',
        label: i18n.t('contextMenu.pasteAndRename', { count: selectedFiles.size }),
        icon: mi(ClipboardList),
        action: () => this.actions.openPasteRename(selectionEntries),
      });
    }

    items.push(...wispUniqueItems);

    if (!isMultiSelect && !file.is_dir) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isText = [
        'txt',
        'md',
        'json',
        'xml',
        'yaml',
        'yml',
        'toml',
        'js',
        'jsx',
        'ts',
        'tsx',
        'py',
        'rb',
        'rs',
        'go',
        'java',
        'c',
        'cpp',
        'h',
        'cs',
        'html',
        'css',
        'scss',
        'sh',
        'sql',
        'vue',
        'svelte',
        'log',
        'csv',
        'ini',
        'conf',
        'env',
      ].includes(ext);
      if (isText) {
        moreItems.push({
          id: 'word-count',
          label: 'Word Count',
          icon: mi(FileText),
          action: async () => {
            try {
              const content = await TauriAPI.readTextFile(file.path);
              const words = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
              const lines = content.split('\n').length;
              const chars = content.length;
              window.dispatchEvent(
                new CustomEvent('wisp:extension-toast', {
                  detail: {
                    title: file.name,
                    description: `${words.toLocaleString(getAppLocale())} words · ${lines.toLocaleString(getAppLocale())} lines · ${chars.toLocaleString(getAppLocale())} chars`,
                  },
                }),
              );
            } catch (err) {
              console.error('Word count failed:', err);
            }
          },
        });
      }
    }

    if (!isMultiSelect && !file.is_dir) {
      moreItems.push({
        id: 'calculate-hash',
        label: 'Calculate Hash',
        icon: mi(Fingerprint),
        action: async () => {
          try {
            const data = await TauriAPI.readBinaryFile(file.path);
            const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            await navigator.clipboard.writeText(sha256);
            window.dispatchEvent(
              new CustomEvent('wisp:extension-toast', {
                detail: {
                  title: 'File Hash',
                  description: `SHA-256: ${sha256} — copied to clipboard`,
                },
              }),
            );
          } catch (err) {
            console.error('Hash failed:', err);
          }
        },
      });
    }

    if (!isMultiSelect && !file.is_dir) {
      moreItems.push({
        id: 'add-bookmark',
        label: i18n.t('contextMenu.addToBookmarks'),
        icon: mi(Bookmark),
        action: async () => {
          try {
            await TauriAPI.addBookmark(file.path, file.name);
            window.dispatchEvent(new CustomEvent('bookmarks-changed'));
          } catch (error) {
            console.error('Failed to add bookmark:', error);
          }
        },
      });
    }

    // Open in Terminal (for files, opens parent directory)
    if (!isMultiSelect && !file.is_dir) {
      moreItems.push({
        id: 'open-terminal',
        label: i18n.t('contextMenu.openInTerminal'),
        icon: mi(Terminal),
        action: () => {
          const parentDir = file.path.split(/[\\/]/).slice(0, -1).join(PATH_SEPARATOR);
          this.actions.openInTerminal(parentDir);
        },
      });
    }

    // Batch Metadata (multi-select only, 2+ files)
    if (isMultiSelect && this.actions.openBatchMetadata) {
      const batchFiles = selectedFilesList.map(resolveEntry);
      moreItems.push({
        id: 'batch-metadata',
        label: i18n.t('contextMenu.editMetadata'),
        icon: mi(Tag),
        action: () => this.actions.openBatchMetadata!(batchFiles),
      });
    }

    // Pin to Sidebar (folders only; #41 — not .app bundles)
    if (!isMultiSelect && file.is_dir && !isAppBundle(file)) {
      moreItems.push({
        id: 'pin-to-sidebar',
        label: i18n.t('contextMenu.pinToSidebar'),
        icon: mi(Pin),
        action: () => this.actions.pinToSidebar(file),
      });
    }

    // Set Folder Color (folders only, single select; #41 — not .app bundles)
    if (!isMultiSelect && file.is_dir && !isAppBundle(file)) {
      const currentFolderColor = getFolderColor(file.path);
      const colorSubmenu: ContextMenuItem[] = FOLDER_COLORS.map((c) => ({
        id: `folder-color-${c.id}`,
        label: colorName(c.id),
        icon: React.createElement('span', {
          style: {
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: c.hex,
            border:
              currentFolderColor?.colorId === c.id
                ? '2px solid #fff'
                : '1px solid rgba(255,255,255,0.2)',
            flexShrink: 0,
          },
        }),
        action: () => {
          setFolderColor(file.path, c.id);
        },
      }));

      if (currentFolderColor) {
        colorSubmenu.push({ id: 'folder-color-sep', label: '', separator: true });
        colorSubmenu.push({
          id: 'folder-color-remove',
          label: i18n.t('contextMenu.removeColor'),
          icon: React.createElement('span', {
            style: {
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '1.5px solid rgba(255,255,255,0.4)',
              position: 'relative',
            },
          }),
          action: () => {
            removeFolderColor(file.path);
          },
        });
      }

      moreItems.push({
        id: 'folder-color',
        label: i18n.t('contextMenu.setFolderColor'),
        icon: mi(Palette),
        submenu: colorSubmenu,
      });
    }

    // Add the "More" submenu if there are items to show
    if (moreItems.length > 0) {
      items.push({
        id: 'more',
        label: i18n.t('contextMenu.more'),
        icon: mi(MoreHorizontal),
        submenu: moreItems,
      });
    }

    // Add actions from extension host
    const extensionItems = extensionHost.getContextMenuItems({
      file,
      selectedFiles: selectedFiles || [],
    });
    if (extensionItems.length > 0) {
      items.push({ id: 'sep-extensions', label: '', separator: true });
      for (const extItem of extensionItems) {
        items.push({
          id: extItem.id,
          label: extItem.label,
          icon: extItem.icon,
          action: () => extItem.action(file, selectedFiles),
        });
      }
    }

    // Add custom actions from extensions
    if (this.config.customActions && this.config.customActions.length > 0) {
      items.push({ id: 'sep-custom', label: '', separator: true });
      items.push(...this.config.customActions);
    }

    return filterItemsByRules(items, file);
  }

  // Get context menu items for empty space (folder background).
  // `selectedFiles` (when passed) grows the Finder #47 entry
  // 用所选项目新建文件夹 for the live selection.
  getEmptySpaceContextMenu(
    currentPath: string,
    clipboard?: { files: FileEntry[]; operation: 'copy' | 'cut' } | null,
    selectedFiles?: Set<string>,
  ): ContextMenuItem[] {
    // Use provided clipboard or fallback to internal clipboard
    const currentClipboard = clipboard !== undefined ? clipboard : this.clipboard;
    const items: ContextMenuItem[] = [];

    // ── Finder-aligned main section（Finder 空白区规格的 Wisp 子集）─────────
    // 新建文件夹 ▸ 新建文档 ▸ 粘贴 ‖ 显示隐藏文件 ▸ 全选 ▸ 刷新；Wisp 独有项
    // 收纳到尾部独立分区。Finder 的「整理方式/显示选项/使用分组」属 P2 不做。

    items.push({
      id: 'new-folder-top',
      label: i18n.t('contextMenu.newFolderTop'),
      icon: mi(FolderClosed),
      shortcut: 'Ctrl+Shift+N',
      action: () => this.actions.createFolder(currentPath),
    });

    // 新建文档 ▸ — Wisp's document-creation capability (新建文件夹 is hoisted
    // to the top level the way Finder's ⌘⇧N item is).
    items.push({
      id: 'new',
      label: i18n.t('contextMenu.newDocument'),
      icon: mi(Plus),
      submenu: [
        {
          id: 'new-text-file',
          label: i18n.t('contextMenu.textFile'),
          icon: mi(FileText),
          action: () => this.actions.createNewTextFile(currentPath),
        },
        {
          id: 'new-file',
          label: i18n.t('contextMenu.newFile'),
          icon: mi(FilePlus2),
          action: () => this.actions.createNewFile(currentPath),
        },
        {
          id: 'new-from-template',
          label: i18n.t('contextMenu.fromTemplate'),
          icon: mi(FileCode2),
          action: () => this.actions.openTemplatePicker(currentPath),
        },
      ],
    });

    // #47: Finder's 用所选项目新建文件夹 — appears at the top level right
    // after 新建 whenever a selection exists (right-clicking the background
    // keeps the selection in Finder; Wisp does the same).
    if (selectedFiles && selectedFiles.size > 0) {
      const selectionList = Array.from(selectedFiles);
      const singleName =
        selectionList.length === 1
          ? (this.config.resolveFile?.(selectionList[0]) ?? entryFromPath(selectionList[0])).name
          : '';
      items.push({
        id: 'new-folder-from-selection',
        label:
          selectionList.length > 1
            ? i18n.t('contextMenu.newFolderFromSelectionItems', {
                count: selectionList.length,
              })
            : i18n.t('contextMenu.newFolderFromSelectionName', { name: singleName }),
        icon: mi(FolderPlus),
        action: () => {
          const filesToMove = selectionList.map(
            (path) => this.config.resolveFile?.(path) ?? entryFromPath(path),
          );
          this.actions.newFolderFromSelection?.(filesToMove, currentPath);
        },
      });
    }

    items.push({ id: 'sep1', label: '', separator: true });

    // 粘贴（剪贴板有文件时可用，Finder 句式含 N 项插值）
    items.push({
      id: 'paste',
      label:
        currentClipboard && currentClipboard.files.length > 0
          ? i18n.t('contextMenu.pasteItems', { count: currentClipboard.files.length })
          : i18n.t('contextMenu.paste'),
      icon: mi(Clipboard),
      shortcut: 'Ctrl+V',
      disabled: !currentClipboard || currentClipboard.files.length === 0,
      action: () => this.actions.paste(currentPath),
    });

    items.push({ id: 'sep2', label: '', separator: true });

    // 显示隐藏文件（Finder 的 ⌘⇧.）
    const hiddenVisible = readHiddenFilesVisible();
    items.push({
      id: 'toggle-hidden-files',
      label: hiddenVisible
        ? i18n.t('contextMenu.hideHiddenFiles')
        : i18n.t('contextMenu.showHiddenFiles'),
      icon: mi(hiddenVisible ? EyeOff : Eye),
      shortcut: isMac ? '⌘⇧.' : 'Ctrl+Shift+.',
      action: () => toggleHiddenFilesState(),
    });

    // Selection actions
    items.push({
      id: 'select-all',
      label: i18n.t('contextMenu.selectAll'),
      icon: mi(CheckSquare),
      shortcut: 'Ctrl+A',
      action: () => this.actions.selectAll(),
    });

    items.push({
      id: 'refresh',
      label: i18n.t('common.refresh'),
      icon: mi(RefreshCw),
      shortcut: 'F5',
      action: () => this.actions.refresh(),
    });

    // ── Wisp-unique trailing section（Finder 没有的项，一条分隔线后）──────
    items.push({ id: 'sep-wisp-unique', label: '', separator: true });

    // View options
    items.push({
      id: 'view',
      label: i18n.t('contextMenu.view'),
      icon: mi(Eye),
      submenu: [
        {
          id: 'view-large',
          label: i18n.t('contextMenu.largeIcons'),
          icon: mi(LayoutGrid),
          action: () => this.actions.setViewMode('large'),
        },
        {
          id: 'view-medium',
          label: i18n.t('contextMenu.mediumIcons'),
          icon: mi(Grid3X3),
          action: () => this.actions.setViewMode('medium'),
        },
        {
          id: 'view-small',
          label: i18n.t('contextMenu.smallIcons'),
          icon: mi(Grid2X2),
          action: () => this.actions.setViewMode('small'),
        },
        {
          id: 'view-list',
          label: i18n.t('contextMenu.list'),
          icon: mi(List),
          action: () => this.actions.setViewMode('list'),
        },
        {
          id: 'view-details',
          label: i18n.t('contextMenu.details'),
          icon: mi(Table),
          action: () => this.actions.setViewMode('details'),
        },
      ],
    });

    items.push({
      id: 'sort',
      label: i18n.t('contextMenu.sortBy'),
      icon: mi(ArrowUpDown),
      submenu: [
        {
          id: 'sort-name',
          label: i18n.t('contextMenu.name'),
          icon: mi(ArrowDownAZ),
          action: () => this.actions.setSortBy('name'),
        },
        {
          id: 'sort-date',
          label: i18n.t('contextMenu.dateModified'),
          icon: mi(Calendar),
          action: () => this.actions.setSortBy('dateModified'),
        },
        {
          id: 'sort-size',
          label: i18n.t('contextMenu.size'),
          icon: mi(HardDrive),
          action: () => this.actions.setSortBy('size'),
        },
        {
          id: 'sort-type',
          label: i18n.t('contextMenu.type'),
          icon: mi(Tag),
          action: () => this.actions.setSortBy('type'),
        },
        { id: 'sort-sep', label: '', separator: true },
        {
          id: 'sort-asc',
          label: i18n.t('contextMenu.ascending'),
          icon: mi(ArrowUpAZ),
          action: () => this.actions.setSortOrder('asc'),
        },
        {
          id: 'sort-desc',
          label: i18n.t('contextMenu.descending'),
          icon: mi(ArrowDownAZ),
          action: () => this.actions.setSortOrder('desc'),
        },
      ],
    });

    // Paste Recent submenu (clipboard history)
    {
      const pasteRecentItem = this.buildPasteRecentSubmenu(currentPath);
      if (pasteRecentItem) items.push(pasteRecentItem);
    }

    items.push({
      id: 'invert-selection',
      label: i18n.t('contextMenu.invertSelection'),
      icon: mi(RotateCcw),
      shortcut: 'Ctrl+Shift+A',
      action: () => this.actions.invertSelection(),
    });

    if (this.config.enableAdvanced) {
      items.push({
        id: 'advanced-selection',
        label: i18n.t('contextMenu.selectBy'),
        icon: mi(Settings),
        action: () => this.actions.openAdvancedSelection(),
      });
    }

    // Terminal
    if (this.config.enableAdvanced) {
      items.push({
        id: 'open-terminal',
        label: i18n.t('contextMenu.openInTerminal'),
        icon: mi(Terminal),
        action: () => this.actions.openInTerminal(currentPath),
      });
    }

    // Recycle Bin
    items.push({
      id: 'open-recycle-bin',
      label: i18n.t('contextMenu.openRecycleBin'),
      icon: mi(Trash2),
      action: () => this.actions.openRecycleBin(),
    });

    // Bookmark current folder
    items.push({
      id: 'add-bookmark-folder',
      label: i18n.t('contextMenu.bookmarkFolder'),
      icon: mi(Bookmark),
      action: async () => {
        try {
          const folderName = currentPath.split(/[\\/]/).filter(Boolean).pop() || currentPath;
          await TauriAPI.addBookmark(currentPath, folderName);
          window.dispatchEvent(new CustomEvent('bookmarks-changed'));
        } catch (error) {
          console.error('Failed to bookmark folder:', error);
        }
      },
    });

    // Add custom actions from extensions
    if (this.config.customActions && this.config.customActions.length > 0) {
      items.push({ id: 'sep-custom', label: '', separator: true });
      items.push(...this.config.customActions);
    }

    return items;
  }
}

/**
 * Filter a flat list of context menu items through user-configured rules.
 * - Separators are never filtered directly; they are removed if they
 *   become leading, trailing, or consecutive after filtering.
 * - Submenu children are recursively filtered; empty submenus are removed.
 */
const filterItemsByRules = (items: ContextMenuItem[], file: FileEntry): ContextMenuItem[] => {
  const filtered: ContextMenuItem[] = [];

  for (const item of items) {
    // Separators are kept temporarily — cleaned up below
    if (item.separator) {
      filtered.push(item);
      continue;
    }

    // Check if this item (by id) should be shown per the user rules
    if (!shouldShowMenuItem(item.id, file)) continue;

    // Recursively filter submenu children
    if (item.submenu && item.submenu.length > 0) {
      const filteredSub = filterItemsByRules(item.submenu, file);
      if (filteredSub.length === 0) continue; // drop empty submenu
      filtered.push({ ...item, submenu: filteredSub });
    } else {
      filtered.push(item);
    }
  }

  // Clean up separators: no leading, no trailing, no consecutive
  const cleaned: ContextMenuItem[] = [];
  for (const item of filtered) {
    if (item.separator) {
      if (cleaned.length === 0) continue; // skip leading
      if (cleaned[cleaned.length - 1]?.separator) continue; // skip consecutive
      cleaned.push(item);
    } else {
      cleaned.push(item);
    }
  }
  // Remove trailing separator
  while (cleaned.length > 0 && cleaned[cleaned.length - 1]?.separator) {
    cleaned.pop();
  }

  return cleaned;
};

// Extension interface for plugins to add custom context menu items
export interface ContextMenuExtension {
  id: string;
  name: string;
  getFileActions?: (file: FileEntry, selectedFiles: Set<string>) => ContextMenuItem[];
  getEmptySpaceActions?: (currentPath: string) => ContextMenuItem[];
}

// Registry for context menu extensions
export class ContextMenuExtensionRegistry {
  private extensions: Map<string, ContextMenuExtension> = new Map();

  register(extension: ContextMenuExtension) {
    this.extensions.set(extension.id, extension);
  }

  unregister(extensionId: string) {
    this.extensions.delete(extensionId);
  }

  getFileActions(file: FileEntry, selectedFiles: Set<string>): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    for (const extension of this.extensions.values()) {
      if (extension.getFileActions) {
        const extensionItems = extension.getFileActions(file, selectedFiles);
        items.push(...extensionItems);
      }
    }

    return items;
  }

  getEmptySpaceActions(currentPath: string): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    for (const extension of this.extensions.values()) {
      if (extension.getEmptySpaceActions) {
        const extensionItems = extension.getEmptySpaceActions(currentPath);
        items.push(...extensionItems);
      }
    }

    return items;
  }
}

// Global registry instance
export const contextMenuRegistry = new ContextMenuExtensionRegistry();
