import React, { useState, useEffect } from 'react';
import { FolderClosed, File, ChevronDown, ChevronRight, GripHorizontal } from 'lucide-react';
import { TauriAPI, BookmarkEntry, FileEntry } from '@/lib/tauri-api';
import { getFolderColorHex } from '@/lib/folder-colors';
import { useWindowEvent } from '@/hooks/use-window-event';
import { useTranslation } from 'react-i18next';

interface SidebarBookmarksProps {
  currentPath: string;
  navigateToPath: (path: string) => void;
  handleFileRightClick?: (file: FileEntry, event: React.MouseEvent) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sectionHeight: number | undefined;
  onResizeStart: (sectionId: string, e: React.MouseEvent) => void;
}

interface SidebarBookmarkItemsProps {
  currentPath: string;
  navigateToPath: (path: string) => void;
  handleFileRightClick?: (file: FileEntry, event: React.MouseEvent) => void;
  showEmpty?: boolean;
}

/** Bookmark rows shared by the legacy section and Quick Access. */
export const SidebarBookmarkItems = ({
  currentPath,
  navigateToPath,
  handleFileRightClick,
  showEmpty = false,
}: SidebarBookmarkItemsProps) => {
  const { t } = useTranslation();
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);

  const loadBookmarks = () => {
    TauriAPI.getBookmarks()
      .then((items) => setBookmarks(items))
      .catch((error) => console.error('Failed to load bookmarks:', error));
  };

  useEffect(() => {
    loadBookmarks();
  }, []);

  useWindowEvent('bookmarks-changed', loadBookmarks);

  // Re-render when folder colors change
  const [_folderColorVersion, setFolderColorVersion] = useState(0);
  useWindowEvent('folder-colors-changed', () => setFolderColorVersion((v) => v + 1));

  const handleRemoveBookmark = async (path: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await TauriAPI.removeBookmark(path);
      setBookmarks((prev) => prev.filter((b) => b.path !== path));
    } catch (error) {
      console.error('Failed to remove bookmark:', error);
    }
  };

  if (bookmarks.length === 0) {
    return showEmpty ? (
      <p className="py-1 text-xs text-xp-text-secondary">{t('sidebar.noBookmarks')}</p>
    ) : null;
  }

  return (
    <div className="border-xp-border/60 mt-1 space-y-0.5 border-t pt-1">
      {bookmarks.map((bookmark) => {
        const bookmarkColor = bookmark.is_dir ? getFolderColorHex(bookmark.path) : null;
        const isActive = currentPath === bookmark.path;
        return (
          <div
            key={bookmark.path}
            className={`group flex w-full cursor-pointer items-center rounded-[2px] px-2 py-1.5 text-xs transition-colors ${
              isActive ? 'wisp-sidebar-item-active' : 'text-xp-text hover:bg-xp-surface-light'
            }`}
            data-drop-target={bookmark.is_dir ? bookmark.path : undefined}
            data-is-folder={bookmark.is_dir ? 'true' : undefined}
            onClick={() => navigateToPath(bookmark.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (handleFileRightClick) {
                const syntheticFile: FileEntry = {
                  name: bookmark.name,
                  path: bookmark.path,
                  size: 0,
                  modified: 0,
                  is_dir: bookmark.is_dir,
                  file_type: bookmark.is_dir ? 'folder' : bookmark.name.split('.').pop() || '',
                  is_readonly: false,
                };
                handleFileRightClick(syntheticFile, e);
              }
            }}
            title={bookmark.path}
          >
            {bookmarkColor && (
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: bookmarkColor,
                  flexShrink: 0,
                  marginRight: 4,
                }}
                aria-hidden="true"
              />
            )}
            {bookmark.is_dir ? (
              <FolderClosed
                size={14}
                className="mr-2 flex-shrink-0 text-xp-text-secondary"
                style={bookmarkColor ? { color: bookmarkColor } : undefined}
              />
            ) : (
              <File size={14} className="mr-2 flex-shrink-0 text-xp-text-secondary" />
            )}
            <span className="flex-1 truncate">{bookmark.name}</span>
            <button
              onClick={(e) => handleRemoveBookmark(bookmark.path, e)}
              className="ml-2 flex-shrink-0 text-xp-text-muted opacity-0 transition-opacity hover:text-xp-red focus:opacity-100 group-hover:opacity-100"
              title={t('sidebarBookmarks.remove')}
              aria-label={`${t('sidebarBookmarks.remove')}: ${bookmark.name}`}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

const SidebarBookmarks = ({
  currentPath,
  navigateToPath,
  handleFileRightClick,
  collapsed,
  onToggleCollapsed,
  sectionHeight,
  onResizeStart,
}: SidebarBookmarksProps) => {
  const { t } = useTranslation();

  return (
    <div
      className="border-b border-xp-border"
      role="region"
      aria-label={t('sidebar.favorites')}
      data-sidebar-section="favorites"
      data-drop-target=""
      data-drop-action="bookmark-add"
    >
      <button
        className="flex w-full items-center px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-xp-text-muted transition-colors hover:bg-xp-surface-light/50"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="mr-1 h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="mr-1 h-3 w-3 flex-shrink-0" />
        )}
        {t('sidebar.favorites')}
      </button>
      {!collapsed && (
        <div
          className="space-y-0.5 overflow-y-auto px-3 pb-2"
          style={sectionHeight ? { maxHeight: sectionHeight } : undefined}
        >
          <SidebarBookmarkItems
            currentPath={currentPath}
            navigateToPath={navigateToPath}
            handleFileRightClick={handleFileRightClick}
            showEmpty
          />
        </div>
      )}
      {/* Resize handle */}
      {!collapsed && (
        <div
          className="group flex h-2 cursor-row-resize items-center justify-center transition-colors hover:bg-xp-surface-light"
          onMouseDown={(e) => onResizeStart('favorites', e)}
        >
          <GripHorizontal className="text-xp-text-muted/20 group-hover:text-xp-text-muted/60 h-3 w-4 transition-colors" />
        </div>
      )}
    </div>
  );
};

export default SidebarBookmarks;
