import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type RecentFile, type FileEntry } from '@/lib/tauri-api';
import SystemDashboard from '@/components/explorer/SystemDashboard';
import { formatFileSize, applyTheme, getFileIcon } from '@/lib/utils';
import { isWindows, ROOT_PATH, PATH_SEPARATOR, CLOCK_UPDATE_INTERVAL_MS } from '@/lib/constants';
import { useAllThemes } from '@/lib/theme-registry';
import { useToast } from '@/hooks/use-toast';
import {
  getDemoDirectory,
  getDemoRecentFiles,
  getDemoUserDirectories,
  isBrowserDemoMode,
} from '@/lib/browser-demo-files';
import { ArrowRight, Clock3, Folder, X } from 'lucide-react';

interface QuickStats {
  totalFiles: number;
  totalFolders: number;
  totalSize: string;
  recentFiles: string[];
}

interface UserDirectories {
  home: string;
  documents: string;
  downloads: string;
  desktop: string;
  pictures: string;
  videos: string;
  music: string;
}

interface HomePageProps {
  onNavigate: (path: string) => void;
  theme: string;
  setTheme: (theme: string) => void;
}

/** Returns a human-readable relative time string using i18n. */
const relativeTime = (
  timestampMs: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string => {
  const now = Date.now();
  const diff = now - timestampMs;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return t('common.justNow');
  if (minutes < 60) return t('common.minutesAgo', { count: minutes });
  if (hours < 24) return t('common.hoursAgo', { count: hours });
  if (days === 1) return t('home.yesterday');
  if (days < 7) return t('common.daysAgo', { count: days });
  return t('home.weeksAgo', { count: Math.floor(days / 7) });
};

/** The Finder-faithful icon for a recent file — same visual as the lists. */
const recentFileEntry = (file: RecentFile): FileEntry => ({
  name: file.name,
  path: file.path,
  is_dir: false,
  size: file.size,
  modified: Math.floor(file.accessed_at / 1000),
  file_type: file.file_type,
  is_readonly: false,
});

/** Hero stat: big light numeral with a small stone label. */
const HeroStat = ({ value, label }: { value: string | number; label: string }) => (
  <div className="flex items-center gap-2">
    <span className="text-3xl font-light tabular-nums leading-none tracking-tight text-xp-text">
      {value}
    </span>
    <span className="rounded-[2px] bg-xp-bg px-2 py-0.5 text-[10px] font-medium text-xp-text-secondary">
      {label}
    </span>
  </div>
);

/** Section heading: title + muted subtitle, optional right-side action. */
const SectionHeader = ({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) => (
  <div className="mb-3 flex items-end justify-between gap-4">
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-xp-text">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-xp-text-muted">{subtitle}</p>}
    </div>
    {action}
  </div>
);

const Clock = () => {
  const { t, i18n } = useTranslation();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), CLOCK_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const locale = i18n.language || 'en';
  const hour = currentTime.getHours();
  const greetingKey =
    hour < 5
      ? 'home.greetingNight'
      : hour < 11
        ? 'home.greetingMorning'
        : hour < 14
          ? 'home.greetingNoon'
          : hour < 18
            ? 'home.greetingAfternoon'
            : 'home.greetingEvening';

  return (
    <div className="flex items-end justify-between gap-8">
      <div>
        <p className="text-3xl font-semibold leading-tight tracking-tight text-xp-text">
          {t(greetingKey)}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-xp-text-muted">
          <Clock3 size={13} aria-hidden="true" />
          {currentTime.toLocaleDateString(locale, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <p className="text-4xl font-extralight tabular-nums leading-none tracking-tighter text-xp-text">
          {currentTime.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
};

const HomePage = ({ onNavigate, theme: _theme, setTheme }: HomePageProps) => {
  const { t } = useTranslation();
  const themes = useAllThemes();
  const { toast } = useToast();
  const [recommendedFolders, setRecommendedFolders] = useState<string[]>([]);
  const [userDirectories, setUserDirectories] = useState<UserDirectories | null>(null);
  const [quickStats, setQuickStats] = useState<QuickStats>({
    totalFiles: 0,
    totalFolders: 0,
    totalSize: '0 B',
    recentFiles: [],
  });
  const [_systemStats, setSystemStats] = useState<{
    os: string;
    arch: string;
    version: string;
    hostname: string;
  } | null>(null);

  // Recent files state
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentFilesLoading, setRecentFilesLoading] = useState(true);
  const [indexCount, setIndexCount] = useState<number | null>(null);

  useEffect(() => {
    if (isBrowserDemoMode()) return;
    TauriAPI.getTokenizerStats()
      .then((s) => setIndexCount(s?.total_files ?? null))
      .catch(() => setIndexCount(null));
  }, []);

  const loadRecentFiles = useCallback(async () => {
    setRecentFilesLoading(true);
    try {
      if (isBrowserDemoMode()) {
        setRecentFiles(getDemoRecentFiles());
        return;
      }
      const files = await TauriAPI.getRecentFiles(12);
      setRecentFiles(files);
    } catch (err) {
      console.error('Failed to load recent files:', err);
    } finally {
      setRecentFilesLoading(false);
    }
  }, []);

  const handleClearRecentFiles = async () => {
    try {
      if (isBrowserDemoMode()) {
        setRecentFiles([]);
        return;
      }
      await TauriAPI.clearRecentFiles();
      setRecentFiles([]);
    } catch (err) {
      console.error('Failed to clear recent files:', err);
    }
  };

  const handleRemoveRecentFile = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      if (isBrowserDemoMode()) {
        setRecentFiles((prev) => prev.filter((file) => file.path !== path));
        return;
      }
      await TauriAPI.removeRecentFile(path);
      setRecentFiles((prev) => prev.filter((f) => f.path !== path));
    } catch (err) {
      console.error('Failed to remove recent file:', err);
    }
  };

  const handleRecentFileClick = (file: RecentFile) => {
    if (file.file_type === 'folder') {
      handleNavigate(file.path);
    } else {
      // Navigate to the parent directory
      const sep = file.path.includes('/') ? '/' : '\\';
      const parts = file.path.split(sep);
      parts.pop();
      const parentDir = parts.join(sep);
      if (parentDir) {
        handleNavigate(parentDir);
      }
    }
  };

  const loadUserData = async () => {
    try {
      if (isBrowserDemoMode()) {
        const userDirs = getDemoUserDirectories();
        const files = getDemoDirectory(userDirs.home) ?? [];
        setUserDirectories(userDirs);
        setRecommendedFolders([`${userDirs.documents}/Launch`, `${userDirs.documents}/Research`]);
        setQuickStats({
          totalFiles: files.filter((file) => !file.is_dir).length,
          totalFolders: files.filter((file) => file.is_dir).length,
          totalSize: formatFileSize(files.reduce((sum, file) => sum + file.size, 0)),
          recentFiles: [],
        });
        return;
      }
      const userDirs = await TauriAPI.getUserDirectories();
      setUserDirectories(userDirs);

      const recent = await TauriAPI.getRecentFolders();
      setRecommendedFolders(recent.slice(0, 4));

      const homeExists = await TauriAPI.fileExists(userDirs.home);
      if (homeExists) {
        const files = await TauriAPI.readDirectory(userDirs.home);
        const totalFiles = files.filter((f) => !f.is_dir).length;
        const totalFolders = files.filter((f) => f.is_dir).length;
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        setQuickStats({
          totalFiles,
          totalFolders,
          totalSize: formatFileSize(totalSize),
          recentFiles: [],
        });
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
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

  const loadSystemStats = async () => {
    try {
      const systemInfo = await TauriAPI.getSystemInfo();
      setSystemStats(systemInfo);
    } catch (error) {
      console.error('Failed to load system stats:', error);
    }
  };

  // Mount: load user data, stats, recents (restored after the legacy-agent
  // state block removal took the old effect with it).
  useEffect(() => {
    loadUserData();
    loadSystemStats();
    loadRecentFiles();
    // Mount-only initialization
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNavigate = (path: string) => {
    // Persisting a recent destination is secondary and must never block navigation.
    if (!isBrowserDemoMode()) {
      TauriAPI.addToRecentFolders(path).catch((error) => {
        console.warn('Failed to record recent folder:', error);
      });
    }
    onNavigate(path);
  };

  const _handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    applyTheme(newTheme);
    const themeData = themes[newTheme as keyof typeof themes];
    toast({
      title: t('home.themeChanged'),
      description: t('home.themeApplied', { theme: themeData?.name || newTheme }),
    });
  };

  return (
    <div className="relative flex h-full flex-col overflow-auto bg-xp-bg text-xp-text">
      <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 gap-y-5 px-6 py-6 lg:grid-cols-12 lg:gap-x-5 lg:px-8">
        {/* Compact header + hero stat row */}
        <div className="order-0 lg:col-span-12">
          <Clock />
          {/* 系统状态：紧凑一行，紧跟问候（用户：放顶上、占地方别太大） */}
          <div className="mt-2">
            <SystemDashboard />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <HeroStat value={quickStats.totalFiles.toLocaleString()} label={t('home.statFiles')} />
            <HeroStat
              value={quickStats.totalFolders.toLocaleString()}
              label={t('home.statFolders')}
            />
            {indexCount !== null && (
              <HeroStat value={indexCount.toLocaleString()} label={t('home.statIndexed')} />
            )}
          </div>
        </div>

        {/* Quick access is gone on purpose — the sidebar already owns it. */}

        {/* Recent folders inline */}
        {recommendedFolders.length > 0 && (
          <div className="order-2 lg:col-span-12">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-xp-text-muted">
              {t('home.recentFolders')}
            </p>
            <div className="flex flex-wrap gap-2">
              {recommendedFolders.map((path) => {
                const name = path.split(/[\\/]/).pop() || path;
                return (
                  <button
                    key={path}
                    onClick={() => handleNavigate(path)}
                    className="group flex items-center gap-2 rounded-[2px] border border-xp-border bg-xp-surface px-3 py-1.5 text-xs transition-colors hover:bg-xp-surface-light"
                    title={path}
                  >
                    <Folder className="h-3 w-3 flex-shrink-0 text-xp-text-secondary" />
                    <span className="max-w-[140px] truncate text-xp-text-secondary group-hover:text-xp-text">
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Files */}
        {!recentFilesLoading && recentFiles.length > 0 && (
          <div className="order-3 lg:col-span-12">
            <SectionHeader
              title={t('home.recentFiles')}
              subtitle={t('home.recentFilesSubtitle')}
              action={
                <button
                  onClick={handleClearRecentFiles}
                  className="flex h-8 items-center rounded-[2px] border border-xp-border bg-xp-surface px-3.5 text-xs font-medium text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                >
                  {t('home.clearAll')}
                </button>
              }
            />
            <div className="flex flex-col gap-0.5">
              {recentFiles.map((file) => {
                return (
                  <div
                    key={`${file.path}-${file.accessed_at}`}
                    className="group relative overflow-hidden rounded-[2px] transition-colors hover:bg-xp-surface-light"
                  >
                    <button
                      type="button"
                      onClick={() => handleRecentFileClick(file)}
                      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left"
                      title={file.path}
                    >
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center text-[24px] leading-none">
                        {getFileIcon(recentFileEntry(file))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-xp-text">
                          {file.name}
                        </span>
                        {/* Full path; rtl direction pins the ellipsis to the
                            leading side so the meaningful tail stays visible. */}
                        <span
                          className="block truncate text-[11px] text-xp-text-muted"
                          title={file.path}
                          style={{ direction: 'rtl', textAlign: 'left' }}
                        >
                          {file.path}
                        </span>
                      </span>
                      <span className="flex-shrink-0 text-[11px] text-xp-text-muted">
                        {relativeTime(file.accessed_at, t)}
                      </span>
                    </button>
                    {/* Remove button on hover */}
                    <button
                      type="button"
                      onClick={(e) => handleRemoveRecentFile(e, file.path)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[2px] bg-xp-surface p-1 text-xp-text-muted opacity-0 transition-opacity hover:text-xp-red group-hover:opacity-100"
                      title={t('home.removeFromRecent')}
                      aria-label={t('home.removeFromRecent')}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!recentFilesLoading && recentFiles.length === 0 && (
          <div className="order-4 lg:col-span-12">
            <div className="flex flex-col items-start justify-between gap-4 rounded-[2px] border border-xp-border bg-muted px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] bg-muted text-xp-blue">
                  <Folder className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-xp-text">{t('home.recentEmptyTitle')}</p>
                  <p className="mt-0.5 text-xs leading-5 text-xp-text-muted">
                    {t('home.recentEmptyDescription')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleNavigate(userDirectories?.home || ROOT_PATH)}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[2px] border border-xp-border bg-xp-surface px-3.5 text-xs font-medium text-xp-text transition-colors hover:border-primary hover:bg-xp-surface-light"
              >
                {t('home.openHome')}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HomePage;
