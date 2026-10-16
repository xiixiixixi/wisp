import { useState, useEffect, useCallback } from 'react';
import {
  Home,
  User,
  FileText,
  Download,
  Monitor,
  Image,
  Cloud,
  LayoutGrid,
  Archive,
} from 'lucide-react';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isMac } from '@/lib/constants';
import { useTranslation } from 'react-i18next';
import { currentNavigationLocation, isCloserNavigationMatch } from './navigation-path';
import { SidebarBookmarkItems } from '@/components/explorer/sidebar/SidebarBookmarks';
import { useWindowEvent } from '@/hooks/use-window-event';
import type { BookmarkDropResult } from '@/lib/bookmark-drop';

interface SidebarQuickAccessProps {
  currentPath: string;
  navigateToPath: (path: string) => void;
  handleFileRightClick?: (file: FileEntry, event: React.MouseEvent) => void;
  handleFileOpen?: (file: FileEntry) => void;
  /** Hands the sidebar-wide winner to later sections (volumes) so only one row lights. */
  onActiveLocationChange?: (path: string | undefined) => void;
}

const SidebarQuickAccess = ({
  currentPath,
  navigateToPath,
  handleFileRightClick,
  handleFileOpen,
  onActiveLocationChange,
}: SidebarQuickAccessProps) => {
  const { t } = useTranslation();
  const [directories, setDirectories] = useState<Awaited<
    ReturnType<typeof TauriAPI.getUserDirectories>
  > | null>(null);
  const [iCloudPath, setICloudPath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [bookmarkDropResult, setBookmarkDropResult] = useState<BookmarkDropResult | null>(null);
  useWindowEvent('bookmark-drop-result', (event) => {
    setBookmarkDropResult((event as CustomEvent<BookmarkDropResult>).detail);
  });
  useEffect(() => {
    if (!bookmarkDropResult || bookmarkDropResult.failed) return;
    const timer = setTimeout(() => setBookmarkDropResult(null), 6000);
    return () => clearTimeout(timer);
  }, [bookmarkDropResult]);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const userDirs = await TauriAPI.getUserDirectories();
      setDirectories(userDirs);
      if (isMac) {
        const mobileRoot = `${userDirs.home}/Library/Mobile Documents`;
        const cloudDocs = `${mobileRoot}/com~apple~CloudDocs`;
        const root = (await TauriAPI.fileExists(mobileRoot)) ? mobileRoot : cloudDocs;
        setICloudPath((await TauriAPI.fileExists(root)) ? root : null);
      }
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const locations = [
    { path: 'wisp://home', Icon: Home, label: t('sidebar.home') },
    ...(isMac ? [{ path: 'wisp://shelves', Icon: Archive, label: t('sidebar.shelf') }] : []),
    ...(directories
      ? [
          { path: directories.home, Icon: User, label: t('sidebar.userDirectory') },
          ...(isMac
            ? [{ path: '/Applications', Icon: LayoutGrid, label: t('sidebar.applications') }]
            : []),
          { path: directories.documents, Icon: FileText, label: t('sidebar.documents') },
          { path: directories.downloads, Icon: Download, label: t('sidebar.downloads') },
          { path: directories.desktop, Icon: Monitor, label: t('sidebar.desktop') },
          { path: directories.pictures, Icon: Image, label: t('sidebar.pictures') },
        ]
      : []),
    ...(iCloudPath ? [{ path: iCloudPath, Icon: Cloud, label: t('sidebar.icloudDrive') }] : []),
  ];
  // The whole sidebar highlights exactly one row: the target closest to the
  // current folder. Quick-access rows win ties against bookmarks (they render
  // first), and bookmarks win whenever they sit deeper than any quick-access
  // ancestor — matching Finder's nearest-ancestor behaviour.
  const [bookmarkPaths, setBookmarkPaths] = useState<string[]>([]);
  const quickWinner = currentNavigationLocation(
    locations.map(({ path }) => path),
    currentPath,
  );
  const bookmarkWinner = currentNavigationLocation(bookmarkPaths, currentPath);
  const activeBookmark =
    bookmarkWinner && isCloserNavigationMatch(bookmarkWinner, quickWinner)
      ? bookmarkWinner
      : undefined;
  const activePath = activeBookmark ?? quickWinner;

  useEffect(() => {
    onActiveLocationChange?.(activePath);
  }, [activePath, onActiveLocationChange]);

  let bookmarkDropMessage = '';
  if (bookmarkDropResult) {
    if (bookmarkDropResult.failed) {
      bookmarkDropMessage = t('sidebar.bookmarkDropFailed', {
        added: bookmarkDropResult.added,
        failed: bookmarkDropResult.failed,
      });
    } else if (bookmarkDropResult.added) {
      bookmarkDropMessage = t('sidebar.bookmarkDropSaved', { count: bookmarkDropResult.added });
    } else {
      bookmarkDropMessage = t('sidebar.bookmarkDropExisting');
    }
  }

  return (
    <section
      className="wisp-nav-section"
      aria-label={t('sidebar.quickAccess')}
      data-sidebar-section="quickAccess"
    >
      <h3 className="wisp-nav-section-heading">{t('sidebar.quickAccess')}</h3>
      <div className="space-y-0.5">
        {locations.map(({ path, Icon, label }) => (
          <button
            key={path}
            type="button"
            onClick={() => navigateToPath(path)}
            className={`wisp-sidebar-item wisp-nav-row ${activePath === path ? 'wisp-sidebar-item-active' : ''}`}
            aria-label={t('sidebar.navigateTo', { label })}
            aria-current={activePath === path ? 'location' : undefined}
            data-drop-target={!path.includes('://') || path === 'wisp://shelves' ? path : undefined}
            data-drop-action={path === 'wisp://shelves' ? 'shelf-add' : undefined}
            data-is-folder={path.includes('://') ? undefined : 'true'}
            title={path.includes('://') ? label : path}
          >
            <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        ))}
      </div>
      <div
        className="wisp-nav-favorites"
        role="region"
        aria-label={t('sidebar.favorites')}
        data-sidebar-section="favorites"
        data-drop-target=""
        data-drop-action="bookmark-add"
      >
        <h3 className="wisp-nav-section-heading">{t('sidebar.favorites')}</h3>
        <p className="wisp-nav-empty">{t('sidebar.bookmarkDropHint')}</p>
        {bookmarkDropResult && (
          <p className="wisp-nav-feedback" role={bookmarkDropResult.failed ? 'alert' : 'status'}>
            {bookmarkDropMessage}
          </p>
        )}
        <SidebarBookmarkItems
          currentPath={currentPath}
          navigateToPath={navigateToPath}
          handleFileRightClick={handleFileRightClick}
          handleFileOpen={handleFileOpen}
          activeBookmarkPath={activeBookmark ?? null}
          onPathsChange={setBookmarkPaths}
        />
      </div>
      {failed && (
        <div className="wisp-nav-feedback" role="status">
          <span>{t('sidebar.locationsFailed')}</span>
          <button type="button" onClick={() => void load()}>
            {t('sidebar.retry')}
          </button>
        </div>
      )}
    </section>
  );
};
export default SidebarQuickAccess;
