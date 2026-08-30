import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type RecentFile } from '@/lib/tauri-api';
import { AgentService, type AgentEvent, type AgentToolCall } from '@/lib/agent-service';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import SystemDashboard from '@/components/explorer/SystemDashboard';
import { formatFileSize, applyTheme } from '@/lib/utils';
import { isWindows, ROOT_PATH, PATH_SEPARATOR, CLOCK_UPDATE_INTERVAL_MS } from '@/lib/constants';
import { useAllThemes } from '@/lib/theme-registry';
import { useToast } from '@/hooks/use-toast';
import {
  getDemoDirectory,
  getDemoRecentFiles,
  getDemoUserDirectories,
  isBrowserDemoMode,
} from '@/lib/browser-demo-files';
import WeatherGlyph from '@/components/weather/WeatherGlyph';
import { useWeather } from '@/hooks/use-weather';
import { getWeatherLocation } from '@/lib/weather-location';
import { describeWeatherCode } from '@/lib/weather';
import {
  ArrowRight,
  Clock3,
  Download,
  FileText,
  Folder,
  Home as HomeIcon,
  Image as ImageIcon,
  Monitor,
  Music,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

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

/** Icon gradient based on file type. */
const recentFileGradient = (fileType: string): string => {
  const t = fileType.toLowerCase();
  if (t === 'folder') return 'from-amber-500 to-amber-600';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(t)) {
    return 'from-pink-500 to-pink-600';
  }
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'].includes(t)) {
    return 'from-orange-500 to-orange-600';
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma'].includes(t)) return 'from-cyan-500 to-cyan-600';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(t)) {
    return 'from-yellow-500 to-yellow-600';
  }
  if (
    [
      'js',
      'ts',
      'jsx',
      'tsx',
      'py',
      'rs',
      'go',
      'java',
      'c',
      'cpp',
      'html',
      'css',
      'json',
      'yaml',
      'toml',
      'xml',
    ].includes(t)
  ) {
    return 'from-emerald-500 to-emerald-600';
  }
  if (['txt', 'md', 'rtf', 'doc', 'docx', 'pdf', 'csv', 'log'].includes(t)) {
    return 'from-blue-500 to-blue-600';
  }
  return 'from-slate-500 to-slate-600';
};

/** Icon-library glyph for recent files based on type. */
const RecentFileTypeIcon = ({
  fileType,
  className = 'w-3.5 h-3.5',
}: {
  fileType: string;
  className?: string;
}) => {
  const t = fileType.toLowerCase();
  if (t === 'folder') return <Folder className={className} />;
  return <FileText className={className} />;
};

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

  const location = getWeatherLocation();
  const { report } = useWeather();
  const descriptor = report ? describeWeatherCode(report.weather_code) : null;

  return (
    <div className="flex items-end justify-between gap-8">
      <div>
        <p className="text-2xl font-semibold leading-tight tracking-tight text-xp-text">
          {t(greetingKey)}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-xp-text-muted">
          <Clock3 size={13} aria-hidden="true" />
          {currentTime.toLocaleDateString(locale, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
          <span className="text-xp-text-muted opacity-60">·</span>
          {t('home.workspace')}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <p className="text-4xl font-extralight tabular-nums leading-none text-xp-text-muted">
          {currentTime.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
        </p>
        {report && descriptor && (
          <div
            className="glass-card flex items-center gap-2 rounded-full px-3 py-1"
            style={
              {
                '--tint-a': 'rgba(120, 150, 240, 0.35)',
                '--tint-b': 'rgba(90, 200, 220, 0.28)',
              } as React.CSSProperties
            }
          >
            <WeatherGlyph
              code={report.weather_code}
              isDay={report.is_day}
              size={14}
              className="text-xp-text-secondary"
            />
            <span className="text-xs font-medium text-xp-text">
              {Math.round(report.temperature)}°
            </span>
            <span className="text-[11px] text-xp-text-muted">
              {t(descriptor.labelKey)} · {location.city}
            </span>
          </div>
        )}
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
  const [_quickStats, setQuickStats] = useState<QuickStats>({
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

  // AI Assistant state
  const [aiInput, setAiInput] = useState('');
  const [aiMessages, setAiMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [aiStreaming, setAiStreaming] = useState('');
  const [aiRunning, setAiRunning] = useState(false);
  const [aiToolCalls, setAiToolCalls] = useState<
    Array<{ id: string; name: string; status: string }>
  >([]);
  const [aiPendingApprovals, setAiPendingApprovals] = useState<AgentToolCall[]>([]);
  const aiScrollRef = useRef<HTMLDivElement>(null);

  const scrollAiToBottom = () => {
    if (aiScrollRef.current) {
      aiScrollRef.current.scrollTop = aiScrollRef.current.scrollHeight;
    }
  };

  useEffect(scrollAiToBottom, [aiMessages, aiStreaming, aiToolCalls]);

  const handleAiSend = async () => {
    const msg = aiInput.trim();
    if (!msg || aiRunning) return;
    setAiInput('');

    const userMsg = { role: 'user' as const, content: msg };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiRunning(true);
    setAiStreaming('');
    setAiToolCalls([]);
    setAiPendingApprovals([]);

    let streamBuf = '';
    const conversationForApi = [...aiMessages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      await AgentService.startAgentChat(
        conversationForApi,
        userDirectories?.home || ROOT_PATH,
        (event: AgentEvent) => {
          switch (event.event_type) {
            case 'text':
            case 'text_delta':
              if (event.text) {
                streamBuf += event.text;
                setAiStreaming(streamBuf);
              }
              break;
            case 'tool_call':
              if (event.tool_call) {
                setAiToolCalls((prev) => [
                  ...prev,
                  {
                    id: event.tool_call!.id,
                    name: event.tool_call!.name,
                    status: event.tool_call!.status,
                  },
                ]);
              }
              break;
            case 'approval_request':
              if (event.tool_call) {
                setAiPendingApprovals((prev) => [...prev, event.tool_call!]);
              }
              break;
            case 'tool_result':
              if (event.tool_call) {
                setAiToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.id === event.tool_call!.id ? { ...tc, status: event.tool_call!.status } : tc,
                  ),
                );
                setAiPendingApprovals((prev) => prev.filter((tc) => tc.id !== event.tool_call!.id));
              }
              break;
            case 'complete': {
              const finalText = streamBuf || event.text || '';
              if (finalText) {
                setAiMessages((prev) => [...prev, { role: 'assistant', content: finalText }]);
              }
              setAiStreaming('');
              streamBuf = '';
              setAiRunning(false);
              setAiToolCalls([]);
              break;
            }
            case 'error':
              if (streamBuf) {
                setAiMessages((prev) => [...prev, { role: 'assistant', content: streamBuf }]);
              }
              setAiMessages((prev) => [
                ...prev,
                { role: 'assistant', content: `Error: ${event.text || 'Unknown error'}` },
              ]);
              setAiStreaming('');
              setAiRunning(false);
              break;
          }
        },
      );
    } catch (err) {
      setAiMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Failed to start agent: ${err}` },
      ]);
      setAiRunning(false);
    }
  };

  const handleApproval = async (toolCallId: string, response: string) => {
    try {
      await AgentService.respondToApproval(toolCallId, response);
      setAiPendingApprovals((prev) => prev.filter((tc) => tc.id !== toolCallId));
    } catch (err) {
      console.error('Approval failed:', err);
    }
  };

  useEffect(() => {
    loadUserData();
    loadSystemStats();
    loadRecentFiles();
    // Mount-only initialization
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const quickAccessTiles = useMemo(() => {
    if (!userDirectories) return [];
    return [
      {
        key: 'home',
        label: t('sidebar.home'),
        path: userDirectories.home,
        Icon: HomeIcon,
        tintA: 'rgba(99, 112, 255, 0.5)',
        tintB: 'rgba(64, 200, 220, 0.38)',
      },
      {
        key: 'documents',
        label: t('sidebar.documents'),
        path: userDirectories.documents,
        Icon: FileText,
        tintA: 'rgba(80, 150, 240, 0.45)',
        tintB: 'rgba(120, 90, 240, 0.38)',
      },
      {
        key: 'downloads',
        label: t('sidebar.downloads'),
        path: userDirectories.downloads,
        Icon: Download,
        tintA: 'rgba(60, 190, 160, 0.45)',
        tintB: 'rgba(90, 200, 130, 0.35)',
      },
      {
        key: 'desktop',
        label: t('sidebar.desktop'),
        path: userDirectories.desktop,
        Icon: Monitor,
        tintA: 'rgba(150, 108, 240, 0.46)',
        tintB: 'rgba(235, 108, 180, 0.38)',
      },
      {
        key: 'pictures',
        label: t('sidebar.pictures'),
        path: userDirectories.pictures,
        Icon: ImageIcon,
        tintA: 'rgba(245, 150, 90, 0.45)',
        tintB: 'rgba(235, 90, 110, 0.38)',
      },
      {
        key: 'music',
        label: t('home.music'),
        path: userDirectories.music,
        Icon: Music,
        tintA: 'rgba(240, 120, 150, 0.42)',
        tintB: 'rgba(150, 90, 235, 0.4)',
      },
    ].filter((tile) => Boolean(tile.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDirectories]);

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
        {/* Compact header */}
        <div className="order-0 lg:col-span-12">
          <Clock />
        </div>

        {/* System dashboard: live CPU / memory / disk gauges */}
        <div className="order-1 lg:col-span-12">
          <SystemDashboard />
        </div>

        {/* Quick access — ambient glass tiles for the everyday locations */}
        {quickAccessTiles.length > 0 && (
          <div className="order-2 lg:col-span-12">
            <p className="mb-2 text-sm font-medium text-xp-text">{t('sidebar.quickAccess')}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {quickAccessTiles.map(({ key, label, path, Icon, tintA, tintB }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleNavigate(path)}
                  title={path}
                  className="glass-card group flex flex-col items-start gap-6 rounded-2xl p-3.5 text-left transition-transform duration-150 hover:-translate-y-0.5"
                  style={
                    {
                      '--tint-a': tintA,
                      '--tint-b': tintB,
                    } as React.CSSProperties
                  }
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-xp-border bg-muted text-xp-text">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="w-full truncate text-xs font-medium text-xp-text">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent folders inline */}
        {recommendedFolders.length > 0 && (
          <div className="order-3 lg:col-span-12">
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
                    className="group flex items-center gap-2 rounded-md border border-xp-border bg-muted px-3 py-1.5 text-xs transition-colors hover:border-primary"
                    title={path}
                  >
                    <Folder className="h-3 w-3 flex-shrink-0 text-xp-blue" />
                    <span className="max-w-[140px] truncate text-xp-text-muted group-hover:text-xp-text">
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
          <div className="order-4 lg:col-span-12">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock3 size={16} aria-hidden="true" />
                <span className="text-sm font-medium text-xp-text">{t('home.recentFiles')}</span>
              </div>
              <button
                onClick={handleClearRecentFiles}
                className="hover:text-xp-error text-[11px] text-xp-text-muted transition-colors"
              >
                {t('home.clearAll')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {recentFiles.map((file) => {
                const gradient = recentFileGradient(file.file_type);
                return (
                  <div
                    key={`${file.path}-${file.accessed_at}`}
                    onClick={() => handleRecentFileClick(file)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleRecentFileClick(file);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="glass-card group relative flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-150"
                    title={file.path}
                  >
                    <div
                      className={`h-7 w-7 rounded-md bg-gradient-to-br ${gradient} flex flex-shrink-0 items-center justify-center`}
                    >
                      <RecentFileTypeIcon
                        fileType={file.file_type}
                        className="h-3.5 w-3.5 text-white"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-xp-text">{file.name}</p>
                      <p className="text-[10px] text-xp-text-muted">
                        {relativeTime(file.accessed_at, t)}
                      </p>
                    </div>
                    {/* Remove button on hover */}
                    <button
                      onClick={(e) => handleRemoveRecentFile(e, file.path)}
                      className="hover:bg-xp-error/20 hover:text-xp-error absolute right-1 top-1 rounded p-0.5 text-xp-text-muted opacity-0 transition-all group-hover:opacity-100"
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
            <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-xp-border bg-muted px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xp-blue">
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
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-xp-border bg-xp-surface px-3.5 text-xs font-medium text-xp-text transition-colors hover:border-primary hover:bg-xp-surface-light"
              >
                {t('home.openHome')}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Legacy built-in Agent: intentionally disconnected from the product UI. */}
        <div className="hidden" aria-hidden="true">
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-xp-border bg-muted shadow-xl shadow-black/10">
            {/* Chat messages area */}
            <div ref={aiScrollRef} className="max-h-72 overflow-y-auto px-5 pb-2 pt-4 sm:px-6">
              {aiMessages.length === 0 && !aiStreaming && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-xp-border bg-muted">
                    <Sparkles className="h-5 w-5 text-xp-blue" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-xp-text">{t('home.agentTitle')}</p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-xp-blue">
                        {t('home.ready')}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm leading-5 text-xp-text-muted">
                      {t('home.agentDescription')}
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {aiMessages.map((msg, i) => (
                  <div
                    // eslint-disable-next-line react/no-array-index-key
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm ${
                        msg.role === 'user'
                          ? 'bg-xp-blue/20 text-xp-text'
                          : 'bg-xp-bg/60 text-xp-text'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <span>{msg.content}</span>
                      ) : (
                        <MarkdownRenderer content={msg.content} />
                      )}
                    </div>
                  </div>
                ))}

                {/* Streaming response */}
                {aiStreaming && (
                  <div className="flex justify-start">
                    <div className="bg-xp-bg/60 max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm text-xp-text">
                      <MarkdownRenderer content={aiStreaming} />
                    </div>
                  </div>
                )}

                {/* Tool calls */}
                {aiToolCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {aiToolCalls.map((tc) => {
                      let dotClass = 'animate-pulse bg-blue-400';
                      if (tc.status === 'completed') {
                        dotClass = 'bg-green-400';
                      } else if (tc.status === 'error' || tc.status === 'denied') {
                        dotClass = 'bg-red-400';
                      }
                      return (
                        <span
                          key={tc.id}
                          className="bg-xp-bg/60 inline-flex items-center gap-1.5 rounded-md border border-xp-border px-2.5 py-1 text-xs text-xp-text-muted"
                        >
                          <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass}`} />
                          {tc.name}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Approval requests */}
                {aiPendingApprovals.map((tc) => {
                  let approvalDetail: string;
                  if (tc.name === 'execute_command') {
                    approvalDetail = String((tc.input as Record<string, unknown>)?.command || '');
                  } else if (tc.name === 'write_file' || tc.name === 'delete') {
                    approvalDetail = String((tc.input as Record<string, unknown>)?.path || '');
                  } else {
                    approvalDetail = JSON.stringify(tc.input).slice(0, 80);
                  }
                  return (
                    <div
                      key={tc.id}
                      className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3"
                    >
                      <p className="mb-1.5 text-xs font-medium text-xp-yellow">
                        {t('home.approve')}: {tc.name}
                      </p>
                      <p className="mb-2 truncate font-mono text-xs text-xp-text-muted">
                        {approvalDetail}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproval(tc.id, 'allow_once')}
                          className="rounded bg-green-600 px-3 py-1 text-xs text-white transition-colors hover:bg-xp-green"
                        >
                          {t('home.thisTime')}
                        </button>
                        <button
                          onClick={() => handleApproval(tc.id, 'allow_always')}
                          className="rounded bg-xp-blue px-3 py-1 text-xs text-white transition-colors hover:opacity-80"
                        >
                          {t('home.always')}
                        </button>
                        <button
                          onClick={() => handleApproval(tc.id, 'deny_always')}
                          className="rounded border border-xp-border bg-xp-surface px-3 py-1 text-xs text-xp-text transition-colors hover:bg-xp-bg"
                        >
                          {t('home.never')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Input area - pinned at bottom */}
            <div className="flex-shrink-0 border-t border-xp-border p-4 sm:px-6 sm:pb-5">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search
                    size={17}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xp-text-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAiSend();
                      }
                    }}
                    placeholder={t('home.askAnything')}
                    disabled={aiRunning}
                    className="h-12 w-full rounded-xl border border-xp-border bg-xp-surface pl-11 pr-24 text-sm text-xp-text placeholder-xp-text-muted shadow-inner transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  />
                  <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                    {aiRunning ? (
                      <button
                        onClick={() => AgentService.cancelSession()}
                        className="bg-xp-error/20 text-xp-error hover:bg-xp-error/30 rounded-md px-2.5 py-1 text-xs transition-colors"
                      >
                        {t('home.stop')}
                      </button>
                    ) : (
                      <button
                        onClick={handleAiSend}
                        disabled={!aiInput.trim()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-xp-blue px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-xp-blue-dark disabled:opacity-30"
                      >
                        {t('home.send')}
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {aiMessages.length === 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    t('home.suggestionListRecent'),
                    t('home.suggestionOrganize'),
                    t('home.suggestionLargeFiles'),
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setAiInput(suggestion);
                      }}
                      className="rounded-lg border border-xp-border bg-muted px-3 py-1.5 text-xs text-xp-text-muted transition-colors hover:border-primary hover:bg-xp-surface-light hover:text-xp-text"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
