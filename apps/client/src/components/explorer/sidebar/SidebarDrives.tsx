import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive, ArrowUpFromLine } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { isWindows, ROOT_PATH } from '@/lib/constants';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

interface Drive {
  letter: string;
  label: string;
  path: string;
  total_space: number;
  free_space: number;
}

interface SidebarDrivesProps {
  navigateToPath: (path: string) => void;
}

const SidebarDrives = ({ navigateToPath }: SidebarDrivesProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [drives, setDrives] = useState<Drive[]>([]);

  const loadDrives = useCallback(async () => {
    try {
      const list = await TauriAPI.listDrives();
      setDrives(list);
    } catch (error) {
      console.error('Failed to load drives:', error);
      setDrives([
        {
          letter: isWindows ? 'C' : '',
          label: isWindows ? t('sidebarDrives.localDisk') : 'Macintosh HD',
          path: ROOT_PATH,
          total_space: 0,
          free_space: 0,
        },
      ]);
    }
  }, [t]);

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
      }
    },
    [loadDrives, t, toast],
  );

  return (
    <div
      className="px-3 py-2"
      role="region"
      aria-label={t(isWindows ? 'sidebar.drives' : 'sidebar.volumes')}
      data-sidebar-section="drives"
    >
      <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-widest text-xp-text-muted">
        {t(isWindows ? 'sidebar.drives' : 'sidebar.volumes')}
      </div>
      <div className="space-y-1">
        {drives.map((drive) => {
          const totalGB =
            drive.total_space > 0 ? Math.round(drive.total_space / (1024 * 1024 * 1024)) : 0;
          const freeGB =
            drive.free_space > 0 ? Math.round(drive.free_space / (1024 * 1024 * 1024)) : 0;
          const usedPct =
            drive.total_space > 0
              ? Math.round(((drive.total_space - drive.free_space) / drive.total_space) * 100)
              : 0;
          return (
            <div key={drive.path} className="group relative">
              <button
                onClick={() => navigateToPath(drive.path)}
                data-drop-target={drive.path}
                data-is-folder="true"
                className="w-full rounded-[2px] px-2 py-1.5 text-left text-xs transition-colors hover:bg-xp-surface-light"
                aria-label={t('navigation.navigateTo', {
                  name: drive.letter ? `${drive.letter}:` : drive.label,
                })}
              >
                <div className="flex items-center">
                  <HardDrive
                    size={15}
                    className="mr-2.5 flex-shrink-0 text-xp-text-muted"
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate text-xp-text">
                    {drive.letter ? `${drive.letter}:` : drive.label}
                  </span>
                  {totalGB > 0 && (
                    <span className="ml-2 flex-shrink-0 pr-5 text-xp-text-muted">
                      {t('sidebarDrives.freeSpace', { size: freeGB })}
                    </span>
                  )}
                </div>
                {totalGB > 0 && (
                  <div className="ml-[25px] mt-1 h-1 overflow-hidden rounded-[2px] bg-xp-border">
                    <div
                      className={`h-full rounded-[2px] transition-all ${usedPct > 90 ? 'bg-xp-red' : 'bg-xp-blue'}`}
                      style={{ width: `${usedPct}%` }}
                    />
                  </div>
                )}
              </button>
              {/* Eject button — only shown for non-root/removable volumes */}
              {drive.path !== '/' && drive.path !== 'C:\\' && (
                <button
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[2px] p-0.5 text-xp-text-muted opacity-0 transition-opacity hover:bg-xp-surface-light hover:text-xp-text group-hover:opacity-100"
                  onClick={(e) => handleEjectVolume(drive.path, e)}
                  title={t('drives.eject')}
                  aria-label={t('drives.eject')}
                >
                  <ArrowUpFromLine size={12} />
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
