import React from 'react';
import { FileEntry, FolderSizeInfo, FileTag } from '@/lib/tauri-api';

export interface ViewComponentProps {
  files: FileEntry[];
  selectedFiles: Set<string>;
  currentPath: string;
  groupId: string;
  getFileIcon: (file: FileEntry) => React.ReactNode;
  formatFileSize: (bytes: number) => string;
  formatFolderSize: (folderSizeInfo: FolderSizeInfo | null, isCalculating?: boolean) => string;
  formatDate: (timestamp: number) => string;
  handleFileClick: (file: FileEntry, event: React.MouseEvent) => void;
  handleFileDoubleClick: (file: FileEntry) => void;
  handleFileRightClick: (file: FileEntry, event: React.MouseEvent) => void;
  handleBackgroundRightClick?: (event: React.MouseEvent) => void;
  getFolderSize: (path: string) => FolderSizeInfo | null;
  isCalculatingSize: (path: string) => boolean;
  calculateFolderSize?: (path: string) => void;
  /** Per-path Finder tags, for rendering coloured dots */
  allTags?: Map<string, import('@/lib/tauri-api').FileTag[]>;
  /** Path of the file currently being renamed inline (details/column views render an input for it) */
  renamingPath?: string | null;
  /** Commit an inline rename; clears the editing state */
  onRenameConfirm?: (oldPath: string, newName: string) => void;
  /** Abort the inline rename; clears the editing state */
  onRenameCancel?: () => void;
  /** Commit an inline rename; resolves false on failure */
  onRenameFile?: (oldPath: string, newName: string) => Promise<boolean>;
  /** Finder's Space — open the focused file in Quick Look */
  onQuickLook?: (file: FileEntry) => void;
}

export interface SizeBadgeInfo {
  percentile: number;
  color: string;
  label: string;
}

export interface FileGridItemProps {
  file: FileEntry;
  isSelected: boolean;
  tags: FileTag[];
  gitStatus: string | null;
  isGridView: boolean;
  isListView: boolean;
  viewMode: string;
  itemSize: string;
  selectedFiles: Set<string>;
  allFiles: FileEntry[];
  getFileIcon: (file: FileEntry) => React.ReactNode;
  formatFileSize: (bytes: number) => string;
  formatFolderSize: (folderSizeInfo: FolderSizeInfo | null, isCalculating?: boolean) => string;
  formatDate: (timestamp: number) => string;
  onFileClick: (file: FileEntry, event: React.MouseEvent) => void;
  onFileDoubleClick: (file: FileEntry) => void;
  onFileRightClick: (file: FileEntry, event: React.MouseEvent) => void;
  getFolderSize: (path: string) => FolderSizeInfo | null;
  isCalculatingSize: (path: string) => boolean;
  /** When true, show a color-coded size percentile badge */
  showSizeBadge?: boolean;
  /** Size percentile info for this file (color, label, percentile) */
  sizeBadgeInfo?: SizeBadgeInfo | null;
  /** Pre-resolved thumbnail URL for image files (from useThumbnailCache) */
  thumbnailUrl?: string;
  /** When true, the file name label is replaced with an inline rename input */
  isRenaming?: boolean;
  /** Caret offset for a label-click rename (caret lands where clicked);
   *  null/undefined selects the base name like Enter/F2 do */
  initialRenameCaretOffset?: number | null;
  /** List of existing file/folder names in the directory (for conflict detection) */
  existingNames?: string[];
  /** Called when the user confirms the rename (Enter key or Tab key) */
  onRenameConfirm?: (oldPath: string, newName: string) => void;
  /** Called when the user cancels the rename (Escape key or blur) */
  onRenameCancel?: () => void;
  /** Called when Tab/Shift+Tab is pressed during rename to hop to the
   *  neighbour (direction 1 = next, -1 = previous). `newName` is null when
   *  the name was left unchanged and only the hop should happen. */
  onRenameTab?: (oldPath: string, newName: string | null, direction: 1 | -1) => void;
  /** Finder: clicking the name label of the already-selected item starts an
   *  inline rename, with the caret placed at the clicked character. */
  onRenameStart?: (file: FileEntry, caretOffset?: number) => void;
}
