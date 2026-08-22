import React, { useState, useEffect } from 'react';
import {
  Home,
  FileText,
  Download,
  Monitor,
  Image,
  Cloud,
  ChevronDown,
  ChevronRight,
  GripHorizontal,
} from 'lucide-react';
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
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sectionHeight: number | undefined;
  onResizeStart: (sectionId: string, e: React.MouseEvent) => void;
}

const SidebarQuickAccess = ({
  currentPath,
  navigateToPath,
  handleFileRightClick,
  collapsed,
  onToggleCollapsed,
  sectionHeight,
  onResizeStart,
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
          const cloudDocsPath = `${userDirs.home}/Library/Mobile Documents/com~apple~CloudDocs`;
          const exists = await TauriAPI.fileExists(cloudDocsPath);
          setICloudPath(exists ? cloudDocsPath : null);
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
      className="border-b border-xp-border"
      role="region"
      aria-label="Quick access"
      data-sidebar-section="quickAccess"
      data-drop-target=""
      data-drop-action="bookmark-add"
    >
      <button
        className="hover:bg-xp-surface-light/50 flex w-full items-center px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-xp-text-muted transition-colors"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="mr-1 h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="mr-1 h-3 w-3 flex-shrink-0" />
        )}
        {t('sidebar.quickAccess')}
      </button>
      {!collapsed && (
        <div
          className="space-y-0.5 overflow-y-auto px-3 pb-2"
          style={sectionHeight ? { maxHeight: sectionHeight } : undefined}
        >
          {userDirectories &&
            (
              [
                {
                  path: 'wisp://home',
                  Icon: Home,
                  labelKey: 'sidebar.home' as const,
                },
                {
                  path: userDirectories.documents,
                  Icon: FileText,
                  labelKey: 'sidebar.documents' as const,
                },
                {
                  path: userDirectories.downloads,
                  Icon: Download,
                  labelKey: 'sidebar.downloads' as const,
                },
                {
                  path: userDirectories.desktop,
                  Icon: Monitor,
                  labelKey: 'sidebar.desktop' as const,
                },
                {
                  path: userDirectories.pictures,
                  Icon: Image,
                  labelKey: 'sidebar.pictures' as const,
                },
              ] as const
            ).map(({ path, Icon, labelKey }) => {
              const label = t(labelKey);
              const isActive = currentPath === path;
              return (
                <button
                  key={labelKey}
                  onClick={() => navigateToPath(path)}
                  className={`flex w-full items-center rounded px-2 py-1.5 text-xs transition-colors ${
                    isActive ? 'wisp-sidebar-item-active' : 'text-xp-text hover:bg-xp-surface-light'
                  }`}
                  aria-label={t('sidebar.navigateTo', { label })}
                >
                  <Icon
                    size={15}
                    className="mr-2.5 flex-shrink-0 text-xp-text-secondary"
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
                  className={`flex w-full items-center rounded px-2 py-1.5 text-xs transition-colors ${
                    isActive ? 'wisp-sidebar-item-active' : 'text-xp-text hover:bg-xp-surface-light'
                  }`}
                  aria-label={t('sidebar.navigateTo', { label })}
                >
                  <Cloud
                    size={15}
                    className="mr-2.5 flex-shrink-0 text-xp-text-secondary"
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
      )}
      {/* Resize handle */}
      <div
        className="group flex h-2 cursor-row-resize items-center justify-center transition-colors hover:bg-xp-surface-light"
        onMouseDown={(e) => onResizeStart('quickAccess', e)}
      >
        <GripHorizontal className="text-xp-text-muted/20 group-hover:text-xp-text-muted/60 h-3 w-4 transition-colors" />
      </div>
    </div>
  );
};

export default SidebarQuickAccess;
