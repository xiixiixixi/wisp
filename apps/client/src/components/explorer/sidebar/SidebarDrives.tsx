import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HardDrive, LoaderCircle, createLucideIcon } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { isWindows } from '@/lib/constants';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

import { currentNavigationLocation } from './navigation-path';

const Eject = createLucideIcon('Eject', [
  ['path', { d: 'm5 13 7-8 7 8Z', key: 'triangle' }],
  ['path', { d: 'M5 17h14v3H5z', key: 'base' }],
]);

interface Drive {
  letter: string;
  label: string;
  path: string;
  total_space: number;
  free_space: number;
}

interface SidebarDrivesProps {
  currentPath?: string;
  navigateToPath: (path: string) => void;
}

const SidebarDrives = ({ currentPath = '/', navigateToPath }: SidebarDrivesProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [drives, setDrives] = useState<Drive[]>([]);
  const ejectingPathsRef = useRef(new Set<string>());
  const [ejectingPaths, setEjectingPaths] = useState<Set<string>>(() => new Set());

  const [failed, setFailed] = useState(false);
  const activePath = currentNavigationLocation(
    drives.map((drive) => drive.path),
    currentPath,
  );

  const loadDrives = useCallback(async () => {
    setFailed(false);
    try {
      const list = await TauriAPI.listDrives();
      setDrives(list);
    } catch (error) {
      console.error('Failed to load drives:', error);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadDrives();
    // macOS does not currently emit a mount event to the webview. Refreshing
    // when Wisp regains focus makes newly attached/ejected volumes appear.
    window.addEventListener('focus', loadDrives);
    return () => window.removeEventListener('focus', loadDrives);
  }, [loadDrives]);

  const handleEjectVolume = useCallback(
    async (path: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (ejectingPathsRef.current.has(path)) return;
      ejectingPathsRef.current.add(path);
      setEjectingPaths(new Set(ejectingPathsRef.current));
      try {
        await TauriAPI.ejectVolume(path);
        toast({ title: t('drives.ejectSuccess') });
        await loadDrives();
      } catch (error) {
        toast({
          title: t('drives.ejectFailed'),
          description: String(error),
          variant: 'destructive',
        });
        console.error('Eject volume failed:', error);
      } finally {
        ejectingPathsRef.current.delete(path);
        setEjectingPaths(new Set(ejectingPathsRef.current));
      }
    },
    [loadDrives, t, toast],
  );

  return (
    <div
      className="wisp-nav-section"
      role="region"
      aria-label={t(isWindows ? 'sidebar.drives' : 'sidebar.volumes')}
      data-sidebar-section="drives"
    >
      <h3 className="wisp-nav-section-heading">
        {t(isWindows ? 'sidebar.drives' : 'sidebar.volumes')}
      </h3>
      {failed && (
        <div className="wisp-nav-feedback" role="status">
          <span>{t('sidebar.drivesFailed')}</span>
          <button type="button" onClick={() => void loadDrives()}>
            {t('sidebar.retry')}
          </button>
        </div>
      )}
      <div className="space-y-1">
        {drives.map((drive) => {
          const ejecting = ejectingPaths.has(drive.path);
          const ejectLabel = t(ejecting ? 'drives.ejecting' : 'drives.eject');
          const totalGB =
            drive.total_space > 0 ? Math.round(drive.total_space / (1024 * 1024 * 1024)) : 0;
          const freeGB =
            drive.free_space > 0 ? Math.round(drive.free_space / (1024 * 1024 * 1024)) : 0;
          const usedPct =
            drive.total_space > 0
              ? Math.round(((drive.total_space - drive.free_space) / drive.total_space) * 100)
              : 0;
          return (
            <div key={drive.path} className="wisp-nav-row-group">
              <button
                onClick={() => navigateToPath(drive.path)}
                data-drop-target={drive.path}
                data-is-folder="true"
                className={`wisp-sidebar-item wisp-nav-row ${activePath === drive.path ? 'wisp-sidebar-item-active' : ''}`}
                aria-current={activePath === drive.path ? 'location' : undefined}
                title={drive.path}
                aria-label={t('navigation.navigateTo', {
                  name: drive.letter ? `${drive.letter}:` : drive.label,
                })}
              >
                <HardDrive size={17} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {drive.letter ? `${drive.letter}: ${drive.label}` : drive.label}
                  </span>
                  {totalGB > 0 && (
                    <>
                      <span className="wisp-drive-details">
                        {t('sidebarDrives.freeSpace', { size: freeGB })}
                      </span>
                      <span
                        className="wisp-drive-meter"
                        data-full={usedPct > 90}
                        aria-hidden="true"
                      >
                        <span style={{ width: `${Math.max(0, Math.min(100, usedPct))}%` }} />
                      </span>
                    </>
                  )}
                </span>
              </button>
              {/* Eject button — only shown for non-root/removable volumes */}
              {drive.path !== '/' && drive.path !== 'C:\\' && (
                <button
                  type="button"
                  className="wisp-nav-row-action wisp-drive-eject"
                  onClick={(e) => handleEjectVolume(drive.path, e)}
                  disabled={ejecting}
                  aria-busy={ejecting}
                  title={ejectLabel}
                  aria-label={`${ejectLabel}: ${drive.label}`}
                >
                  {ejecting ? (
                    <LoaderCircle
                      size={16}
                      className="wisp-nav-action-spinner"
                      aria-hidden="true"
                    />
                  ) : (
                    <Eject size={16} aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SidebarDrives;
