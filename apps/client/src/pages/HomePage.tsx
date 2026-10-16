import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Copy, FolderOpen, MoreHorizontal, Pin, PinOff, Plus, Search, X } from 'lucide-react';
import { TauriAPI, type BookmarkEntry, type FileEntry, type RecentFile } from '@/lib/tauri-api';
import { getFileIcon } from '@/lib/utils';
import { getDemoUserDirectories, isBrowserDemoMode } from '@/lib/browser-demo-files';
import { openRecentEntry, parentDirectory } from '@/lib/recent-entry-actions';
import { homeParentLabel } from '@/lib/home-entry-path';
import { useWindowEvent } from '@/hooks/use-window-event';
import { useToast } from '@/hooks/use-toast';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu';
import SystemDashboard from '@/components/explorer/SystemDashboard';
import '@/styles/home-entry.css';

interface HomePageProps {
  onNavigate: (path: string) => void;
  onQuickLook?: (file: FileEntry) => void;
  onReveal?: (path: string) => void;
  theme: string;
  setTheme: (theme: string) => void;
}
type EntryFilter = 'all' | 'files' | 'folders';
type Entry = RecentFile | BookmarkEntry;
type MenuState = {
  x: number;
  y: number;
  kind: 'recent' | 'pinned' | 'history' | 'pick';
  entry?: Entry;
};
const isDirectory = (entry: Entry) =>
  'is_dir' in entry ? entry.is_dir : entry.file_type === 'folder';
const asFileEntry = (entry: Entry): FileEntry => ({
  name: entry.name,
  path: entry.path,
  is_dir: isDirectory(entry),
  size: 'size' in entry ? entry.size : 0,
  modified: 'accessed_at' in entry ? Math.floor(entry.accessed_at / 1000) : 0,
  file_type: 'file_type' in entry ? entry.file_type : 'folder',
  is_readonly: false,
});
const HomePage = ({ onNavigate, onQuickLook, onReveal }: HomePageProps) => {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const id = useId();
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [home, setHome] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<EntryFilter>('all');
  const [showAllPins, setShowAllPins] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const generation = useRef({ recent: 0, bookmarks: 0 });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const filters: EntryFilter[] = ['all', 'files', 'folders'];
  const loadRecent = useCallback(async () => {
    const request = ++generation.current.recent;
    try {
      const entries = await TauriAPI.getRecentFiles(200);
      if (request !== generation.current.recent) return;
      setRecent([...entries].sort((a, b) => b.accessed_at - a.accessed_at));
      setLoadError(false);
    } catch {
      if (request === generation.current.recent) setLoadError(true);
    } finally {
      if (request === generation.current.recent) setLoading(false);
    }
  }, []);
  const loadBookmarks = useCallback(() => {
    const request = ++generation.current.bookmarks;
    void TauriAPI.getBookmarks()
      .then((entries) => {
        if (request === generation.current.bookmarks) setBookmarks(entries);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const requests = generation.current;
    void loadRecent();
    loadBookmarks();
    if (isBrowserDemoMode()) setHome(getDemoUserDirectories().home);
    else {
      void TauriAPI.getUserDirectories()
        .then((dirs) => setHome(dirs.home))
        .catch(() => undefined);
    }
    return () => {
      requests.recent++;
      requests.bookmarks++;
    };
  }, [loadRecent, loadBookmarks]);
  useWindowEvent('recent-files-changed', loadRecent);
  useWindowEvent('bookmarks-changed', loadBookmarks);
  useWindowEvent('focus', loadRecent);
  const reportAction = (action: () => Promise<unknown>) => {
    void action().catch(() =>
      toast({
        title: t('homeEntry.actionFailed', { defaultValue: '操作未完成，请重试' }),
        variant: 'destructive',
      }),
    );
  };
  const openEntry = async (entry: Entry) => {
    if (opening) return;
    setOpening(entry.path);
    setActionError(null);
    try {
      await openRecentEntry({ path: entry.path, isDir: isDirectory(entry) }, onNavigate, {
        openDemoFile: onQuickLook,
      });
    } catch {
      setActionError(
        t('homeEntry.openFailed', {
          name: entry.name,
          defaultValue: '无法打开“{{name}}”。请检查文件是否存在，或所在磁盘是否已连接。',
        }),
      );
    } finally {
      setOpening(null);
    }
  };
  const chooseFolder = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isBrowserDemoMode()) {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ x: rect.left, y: rect.bottom + 6, kind: 'pick' });
      return;
    }
    reportAction(async () => {
      const paths = await TauriAPI.showOpenDialog({ directory: true, multiple: false });
      if (paths?.[0]) {
        const path = paths[0];
        await TauriAPI.addBookmark(path, path.split(/[/\\]/).filter(Boolean).pop() || path);
      }
    });
  };
  const openMenu = (
    event: React.MouseEvent<HTMLElement>,
    kind: MenuState['kind'],
    entry?: Entry,
  ) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: event.type === 'contextmenu' ? event.clientX : rect.left,
      y: event.type === 'contextmenu' ? event.clientY : rect.bottom + 4,
      kind,
      entry,
    });
  };
  const pinned = bookmarks.filter((entry) => entry.is_dir);
  const filtered = recent.filter(
    (entry) => filter === 'all' || (entry.file_type === 'folder') === (filter === 'folders'),
  );
  const visible = filtered.slice(0, 30);
  const relativeTime = (time: number) => {
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
    if (minutes < 1) return t('common.justNow');
    if (minutes < 60) return t('common.minutesAgo', { count: minutes });
    if (minutes < 1440) return t('common.hoursAgo', { count: Math.floor(minutes / 60) });
    if (minutes < 2880) return t('home.yesterday');
    return new Date(time).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
  };
  const menuItems: ContextMenuItem[] = [];
  if (menu?.kind === 'pick') {
    const dirs = getDemoUserDirectories();
    [
      dirs.documents,
      `${dirs.documents}/Launch`,
      `${dirs.documents}/Research`,
      dirs.downloads,
    ].forEach((path) => {
      const name = path.split('/').pop()!;
      menuItems.push({
        id: path,
        label: name,
        icon: <FolderOpen size={15} />,
        disabled: pinned.some((entry) => entry.path === path),
        action: () => reportAction(() => TauriAPI.addBookmark(path, name)),
      });
    });
  } else if (menu?.kind === 'history') {
    menuItems.push({
      id: 'clear',
      label: t('homeEntry.clearHistory', { defaultValue: '清除访问记录' }),
      icon: <X size={15} />,
      disabled: !recent.length,
      action: () => reportAction(() => TauriAPI.clearRecentFiles()),
    });
  } else if (menu?.entry) {
    const entry = menu.entry;
    const isPinned = pinned.some((item) => item.path === entry.path);
    menuItems.push({
      id: 'open',
      label: t('homeEntry.open', { defaultValue: '打开' }),
      icon: <FolderOpen size={15} />,
      action: () => {
        void openEntry(entry);
      },
    });
    if (!isDirectory(entry)) {
      menuItems.push({
        id: 'reveal',
        label: t('homeEntry.reveal', { defaultValue: '在文件夹中显示' }),
        icon: <FolderOpen size={15} />,
        action: () => (onReveal ? onReveal(entry.path) : onNavigate(parentDirectory(entry.path))),
      });
    }
    menuItems.push({
      id: 'copy',
      label: t('homeEntry.copyPath', { defaultValue: '复制完整路径' }),
      icon: <Copy size={15} />,
      action: () => reportAction(() => navigator.clipboard.writeText(entry.path)),
    });
    if (isDirectory(entry)) {
      menuItems.push({
        id: 'pin',
        label: isPinned
          ? t('homeEntry.unpin', { defaultValue: '取消固定' })
          : t('homeEntry.pin', { defaultValue: '固定位置' }),
        icon: isPinned ? <PinOff size={15} /> : <Pin size={15} />,
        action: () =>
          reportAction(() =>
            isPinned
              ? TauriAPI.removeBookmark(entry.path)
              : TauriAPI.addBookmark(entry.path, entry.name),
          ),
      });
    }
    if (menu.kind === 'recent') {
      menuItems.push({
        id: 'remove',
        label: t('home.removeFromRecent'),
        icon: <X size={15} />,
        action: () => reportAction(() => TauriAPI.removeRecentFile(entry.path)),
      });
    }
  }
  const moreButton = (entry: Entry, kind: 'pinned' | 'recent') => (
    <button
      type="button"
      className="wisp-entry-more"
      aria-label={t('homeEntry.itemActions', { name: entry.name, defaultValue: '{{name}} 的操作' })}
      aria-haspopup="menu"
      onClick={(event) => openMenu(event, kind, entry)}
    >
      <MoreHorizontal size={16} />
    </button>
  );
  const entryLabel = (entry: Entry) => (
    <>
      <span className="wisp-entry-icon" aria-hidden="true">
        {getFileIcon(asFileEntry(entry))}
      </span>
      <span className="wisp-entry-name">
        <strong>{entry.name}</strong>
        <span title={parentDirectory(entry.path)}>{homeParentLabel(entry.path, home)}</span>
      </span>
    </>
  );
  return (
    <div className="wisp-home wisp-entry-home">
      <div className="wisp-entry-layout">
        <header className="wisp-entry-heading">
          <h1>{t('homeEntry.title', { defaultValue: '主页' })}</h1>
          <button type="button" className="wisp-entry-text-button" onClick={chooseFolder}>
            <Plus size={15} />
            {t('homeEntry.addPin', { defaultValue: '固定文件夹' })}
          </button>
        </header>
        <div className="wisp-entry-body">
          {pinned.length > 0 && (
            <section className="wisp-entry-pins" aria-labelledby={`${id}-pins`}>
              <div className="wisp-entry-section-heading">
                <h2 id={`${id}-pins`}>{t('homeEntry.pinned', { defaultValue: '固定位置' })}</h2>
                {pinned.length > 4 && (
                  <button
                    type="button"
                    className="wisp-entry-text-button"
                    aria-expanded={showAllPins}
                    onClick={() => setShowAllPins(!showAllPins)}
                  >
                    {showAllPins
                      ? t('homeEntry.less', { defaultValue: '收起' })
                      : t('homeEntry.showAll', { defaultValue: '查看全部' })}
                  </button>
                )}
              </div>
              <div className="wisp-entry-pin-grid">
                {(showAllPins ? pinned : pinned.slice(0, 4)).map((entry) => (
                  <div
                    className="wisp-entry-pin"
                    key={entry.path}
                    onContextMenu={(event) => openMenu(event, 'pinned', entry)}
                  >
                    <button
                      type="button"
                      className="wisp-entry-pin-open"
                      onClick={() => {
                        void openEntry(entry);
                      }}
                      title={entry.path}
                    >
                      {entryLabel(entry)}
                    </button>
                    {moreButton(entry, 'pinned')}
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="wisp-entry-recents" aria-labelledby={`${id}-recents`}>
            <div className="wisp-entry-recent-toolbar">
              <h2 id={`${id}-recents`}>{t('homeEntry.recent', { defaultValue: '最近访问' })}</h2>
              <div
                className="wisp-entry-tabs"
                role="tablist"
                aria-label={t('homeEntry.types', { defaultValue: '最近访问类型' })}
              >
                {filters.map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${value}`}
                    aria-selected={filter === value}
                    aria-controls={`${id}-list`}
                    tabIndex={filter === value ? 0 : -1}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    onClick={() => setFilter(value)}
                    onKeyDown={(event) => {
                      let next: number;
                      if (event.key === 'ArrowRight') next = (index + 1) % filters.length;
                      else if (event.key === 'ArrowLeft') {
                        next = (index + filters.length - 1) % filters.length;
                      } else if (event.key === 'Home') next = 0;
                      else if (event.key === 'End') next = filters.length - 1;
                      else return;
                      event.preventDefault();
                      setFilter(filters[next]);
                      tabRefs.current[next]?.focus();
                    }}
                  >
                    {t(`homeEntry.${value}`, {
                      defaultValue: { all: '全部', files: '文件', folders: '文件夹' }[value],
                    })}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="wisp-entry-more"
                aria-label={t('homeEntry.historyActions', { defaultValue: '访问记录操作' })}
                aria-haspopup="menu"
                onClick={(event) => openMenu(event, 'history')}
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
            {actionError && (
              <div className="wisp-entry-error" role="alert">
                <span>{actionError}</span>
                <button
                  type="button"
                  className="wisp-entry-more"
                  aria-label={t('common.close')}
                  onClick={() => setActionError(null)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div
              id={`${id}-list`}
              role="tabpanel"
              aria-labelledby={`${id}-tab-${filter}`}
              aria-busy={loading}
            >
              {!loadError && !loading && visible.length > 0 && (
                <div className="wisp-entry-column-labels" aria-hidden="true">
                  <span className="wisp-entry-name-label">
                    {t('homeEntry.nameColumn', { defaultValue: '名称' })}
                  </span>
                  <span className="wisp-entry-location-label">
                    {t('homeEntry.locationColumn', { defaultValue: '所在位置' })}
                  </span>
                  <span className="wisp-entry-time-label">
                    {t('homeEntry.lastOpened', { defaultValue: '上次打开' })}
                  </span>
                </div>
              )}
              {loadError && (
                <div className="wisp-entry-empty" role="alert">
                  <p>{t('homeEntry.loadFailed', { defaultValue: '暂时无法读取访问记录' })}</p>
                  <button
                    type="button"
                    className="wisp-entry-text-button"
                    onClick={() => {
                      void loadRecent();
                    }}
                  >
                    {t('homeEntry.retry', { defaultValue: '重试' })}
                  </button>
                </div>
              )}
              {!loadError && loading && (
                <p className="wisp-entry-empty" role="status">
                  {t('homeEntry.loading', { defaultValue: '正在读取访问记录…' })}
                </p>
              )}
              {!loadError && !loading && visible.length === 0 && (
                <div className="wisp-entry-empty">
                  <FolderOpen size={28} aria-hidden="true" />
                  <h3>
                    {t(`homeEntry.empty.${filter}`, {
                      defaultValue: {
                        all: '从一个文件或文件夹开始',
                        files: '还没有最近打开的文件',
                        folders: '还没有最近访问的文件夹',
                      }[filter],
                    })}
                  </h3>
                  <p>
                    {t('homeEntry.emptyHint', {
                      defaultValue: '在 Wisp 中打开的项目会出现在这里。',
                    })}
                  </p>
                  <button
                    type="button"
                    className="wisp-entry-text-button"
                    onClick={() => window.dispatchEvent(new Event('wisp-open-command-palette'))}
                  >
                    <Search size={15} />
                    {t('homeEntry.search', { defaultValue: '搜索文件和文件夹' })}
                  </button>
                </div>
              )}
              <ul className="wisp-entry-list">
                {visible.map((entry) => (
                  <li
                    className="wisp-entry-row"
                    key={entry.path}
                    onContextMenu={(event) => openMenu(event, 'recent', entry)}
                  >
                    <button
                      type="button"
                      className="wisp-entry-row-open"
                      onClick={() => {
                        void openEntry(entry);
                      }}
                      disabled={opening === entry.path}
                      title={entry.path}
                    >
                      <span className="wisp-entry-identity">
                        <span className="wisp-entry-icon" aria-hidden="true">
                          {getFileIcon(asFileEntry(entry))}
                        </span>
                        <strong>{entry.name}</strong>
                      </span>
                      <span className="wisp-entry-location" title={parentDirectory(entry.path)}>
                        {homeParentLabel(entry.path, home)}
                      </span>
                      <time
                        dateTime={new Date(entry.accessed_at).toISOString()}
                        title={new Date(entry.accessed_at).toLocaleString(i18n.language)}
                      >
                        {relativeTime(entry.accessed_at)}
                      </time>
                    </button>
                    {moreButton(entry, 'recent')}
                  </li>
                ))}
              </ul>
              {filtered.length > visible.length && (
                <p className="wisp-entry-limit">
                  {t('homeEntry.limit', {
                    count: visible.length,
                    defaultValue: '显示最近 {{count}} 项',
                  })}
                </p>
              )}
            </div>
          </section>
        </div>
        <SystemDashboard />
      </div>
      {menu &&
        createPortal(
          <ContextMenu
            isOpen
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={menuItems}
          />,
          document.body,
        )}
    </div>
  );
};
export default HomePage;
