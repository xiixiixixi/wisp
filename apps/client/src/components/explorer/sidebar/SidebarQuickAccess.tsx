import { useState, useEffect, useCallback } from 'react';
import { Home, User, FileText, Download, Monitor, Image, Cloud, LayoutGrid } from 'lucide-react';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isMac } from '@/lib/constants';
import { useTranslation } from 'react-i18next';
import { currentNavigationLocation } from './navigation-path';
import { SidebarBookmarkItems } from '@/components/explorer/sidebar/SidebarBookmarks';

interface SidebarQuickAccessProps {
  currentPath: string;
  navigateToPath: (path: string) => void;
  handleFileRightClick?: (file: FileEntry, event: React.MouseEvent) => void;
  handleFileOpen?: (file: FileEntry) => void;
}

const SidebarQuickAccess = ({
  currentPath,
  navigateToPath,
  handleFileRightClick,
  handleFileOpen,
}: SidebarQuickAccessProps) => {
  const { t } = useTranslation();
  const [directories, setDirectories] = useState<Awaited<
    ReturnType<typeof TauriAPI.getUserDirectories>
  > | null>(null);
  const [iCloudPath, setICloudPath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
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
  const activePath = currentNavigationLocation(
    locations.map(({ path }) => path),
    currentPath,
  );

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
            data-drop-target={path.includes('://') ? undefined : path}
            data-is-folder={path.includes('://') ? undefined : 'true'}
            title={path.includes('://') ? label : path}
          >
            <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        ))}
        <SidebarBookmarkItems
          currentPath={currentPath}
          navigateToPath={navigateToPath}
          handleFileRightClick={handleFileRightClick}
          handleFileOpen={handleFileOpen}
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
