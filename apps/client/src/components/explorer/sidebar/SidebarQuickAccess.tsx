import React, { useState, useEffect } from 'react';
import { Home, User, FileText, Download, Monitor, Image, Cloud } from 'lucide-react';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { PATH_SEPARATOR, isWindows, isMac } from '@/lib/constants';
import { useTranslation } from 'react-i18next';
import { SidebarBookmarkItems } from '@/components/explorer/sidebar/SidebarBookmarks';

interface UserDirectories {
  home: string;
  documents: string;
  downloads: string;
  desktop: string;
  pictures: string;
  videos: string;
  music: string;
}

interface SidebarQuickAccessProps {
  currentPath: string;
  navigateToPath: (path: string) => void;
  handleFileRightClick?: (file: FileEntry, event: React.MouseEvent) => void;
}

const SidebarQuickAccess = ({
  currentPath,
  navigateToPath,
  handleFileRightClick,
}: SidebarQuickAccessProps) => {
  const { t } = useTranslation();
  const [userDirectories, setUserDirectories] = useState<UserDirectories | null>(null);
  const [iCloudPath, setICloudPath] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const userDirs = await TauriAPI.getUserDirectories();
        setUserDirectories(userDirs);
        if (isMac) {
          // Finder's iCloud Drive is the whole Mobile Documents root —
          // CloudDocs holds only Desktop/Documents; app containers
          // (Keynote, GoodNotes, …) are its siblings and must show too.
          const mobileRoot = `${userDirs.home}/Library/Mobile Documents`;
          const cloudDocs = `${mobileRoot}/com~apple~CloudDocs`;
          const root = (await TauriAPI.fileExists(mobileRoot)) ? mobileRoot : cloudDocs;
          setICloudPath((await TauriAPI.fileExists(root)) ? root : null);
        }
      } catch (error) {
        console.error('Failed to load user directories:', error);
        const home = isWindows ? 'C:\\Users\\Public' : '/home/user';
        setUserDirectories({
          home,
          documents: `${home + PATH_SEPARATOR}Documents`,
          downloads: `${home + PATH_SEPARATOR}Downloads`,
          desktop: `${home + PATH_SEPARATOR}Desktop`,
          pictures: `${home + PATH_SEPARATOR}Pictures`,
          videos: `${home + PATH_SEPARATOR}Videos`,
          music: `${home + PATH_SEPARATOR}Music`,
        });
      }
    };
    load();
  }, []);

  return (
    <div
      className="px-3 py-2"
      role="region"
      aria-label={t('sidebar.quickAccess')}
      data-sidebar-section="quickAccess"
      data-drop-target=""
      data-drop-action="bookmark-add"
    >
      <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-widest text-xp-text-muted">
        {t('sidebar.quickAccess')}
      </div>
      <div className="space-y-0.5">
        {userDirectories &&
          (
            [
              {
                path: 'wisp://home',
                Icon: Home,
                labelKey: 'sidebar.home' as const,
                tone: 'text-xp-blue',
              },
              {
                path: userDirectories.home,
                Icon: User,
                labelKey: 'sidebar.userDirectory' as const,
                tone: 'text-xp-cyan',
              },
              {
                path: userDirectories.documents,
                Icon: FileText,
                labelKey: 'sidebar.documents' as const,
                tone: 'text-xp-purple',
              },
              {
                path: userDirectories.downloads,
                Icon: Download,
                labelKey: 'sidebar.downloads' as const,
                tone: 'text-xp-orange',
              },
              {
                path: userDirectories.desktop,
                Icon: Monitor,
                labelKey: 'sidebar.desktop' as const,
                tone: 'text-xp-yellow',
              },
              {
                path: userDirectories.pictures,
                Icon: Image,
                labelKey: 'sidebar.pictures' as const,
                tone: 'text-xp-pink',
              },
            ] as const
          ).map(({ path, Icon, labelKey, tone }) => {
            const label = t(labelKey);
            const isActive = currentPath === path;
            return (
              <button
                key={labelKey}
                onClick={() => navigateToPath(path)}
                className={`flex w-full items-center rounded-lg px-2.5 py-[7px] text-[13px] transition-colors ${
                  isActive ? 'wisp-sidebar-item-active' : 'text-xp-text hover:bg-xp-surface-light'
                }`}
                aria-label={t('sidebar.navigateTo', { label })}
              >
                <Icon
                  size={16}
                  strokeWidth={1.75}
                  className={`mr-2.5 flex-shrink-0 ${tone}`}
                  aria-hidden="true"
                />
                {label}
              </button>
            );
          })}
        {iCloudPath &&
          (() => {
            const isActive = currentPath === iCloudPath;
            const label = t('sidebar.icloudDrive');
            return (
              <button
                key="icloud"
                onClick={() => navigateToPath(iCloudPath)}
                className={`flex w-full items-center rounded-lg px-2.5 py-[7px] text-[13px] transition-colors ${
                  isActive ? 'wisp-sidebar-item-active' : 'text-xp-text hover:bg-xp-surface-light'
                }`}
                aria-label={t('sidebar.navigateTo', { label })}
              >
                <Cloud
                  size={16}
                  strokeWidth={1.75}
                  className="mr-2.5 flex-shrink-0 text-xp-blue"
                  aria-hidden="true"
                />
                {label}
              </button>
            );
          })()}
        <SidebarBookmarkItems
          currentPath={currentPath}
          navigateToPath={navigateToPath}
          handleFileRightClick={handleFileRightClick}
        />
      </div>
    </div>
  );
};

export default SidebarQuickAccess;
