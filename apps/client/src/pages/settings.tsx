import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { isTauri } from '@/lib/transport';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  FolderOpen,
  Search,
  Accessibility,
  Keyboard,
  Store,
  HardDrive,
  ClipboardList,
  History,
  MousePointerClick,
  Settings2,
  ChevronRight,
  FileCode,
  RefreshCw,
  Download,
  Heart,
  Github,
  ExternalLink,
  Info,
} from 'lucide-react';
import TokenizerSettings from '@/components/TokenizerSettings';
import BackupRestoreSettings from '@/components/settings/BackupRestoreSettings';
import AuditLogSettings from '@/components/settings/AuditLogSettings';
import VersioningSettings from '@/components/settings/VersioningSettings';
import ContextMenuRulesCard from '@/components/settings/ContextMenuRulesCard';
import useUpdater from '@/hooks/use-updater';
import ShortcutsSettingsPanel from '@/components/settings/ShortcutsSettings';
import GeneralSettings from '@/components/settings/GeneralSettings';
import ExplorerSettings from '@/components/settings/ExplorerSettings';
import SearchProviderSettings from '@/components/settings/SearchProviderSettings';
import AccessibilitySettings from '@/components/settings/AccessibilitySettings';
import FileAssociationsSettings from '@/components/settings/FileAssociationsSettings';
import { applyTheme, loadFontSize } from '@/lib/utils';
import { normalizeLanguage } from '@/lib/language-settings';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  Toggle,
  SettingRow,
  migrateLegacyAiSettings,
} from '@/components/settings/shared';
import wispLogo from '../../../src-tauri/icons/icon.png';

type SettingsTab =
  | 'general'
  | 'explorer'
  | 'file-associations'
  | 'context-menu'
  | 'indexing'
  | 'shortcuts'
  | 'accessibility'
  | 'marketplace'
  | 'backup'
  | 'audit'
  | 'versioning'
  | 'about';

type TabDef = { id: SettingsTab; label: string; icon: React.ElementType; description: string };

const buildTabs = (t: (key: string) => string): TabDef[] => [
  {
    id: 'general',
    label: t('settings.tabs.general'),
    icon: Settings2,
    description: t('settings.tabs.generalDesc'),
  },
  {
    id: 'explorer',
    label: t('settings.tabs.explorer'),
    icon: FolderOpen,
    description: t('settings.tabs.explorerDesc'),
  },
  {
    id: 'file-associations',
    label: t('settings.tabs.fileAssociations'),
    icon: FileCode,
    description: t('settings.tabs.fileAssociationsDesc'),
  },
  {
    id: 'context-menu',
    label: t('settings.tabs.contextMenu'),
    icon: MousePointerClick,
    description: t('settings.tabs.contextMenuDesc'),
  },
  {
    id: 'indexing',
    label: t('settings.tabs.indexing'),
    icon: Search,
    description: t('settings.tabs.indexingDesc'),
  },
  {
    id: 'shortcuts',
    label: t('settings.tabs.shortcuts'),
    icon: Keyboard,
    description: t('settings.tabs.shortcutsDesc'),
  },
  {
    id: 'marketplace',
    label: t('settings.tabs.marketplace'),
    icon: Store,
    description: t('settings.tabs.marketplaceDesc'),
  },
  {
    id: 'accessibility',
    label: t('settings.tabs.accessibility'),
    icon: Accessibility,
    description: t('settings.tabs.accessibilityDesc'),
  },
  {
    id: 'backup',
    label: t('settings.tabs.backup'),
    icon: HardDrive,
    description: t('settings.tabs.backupDesc'),
  },
  {
    id: 'audit',
    label: t('settings.tabs.audit'),
    icon: ClipboardList,
    description: t('settings.tabs.auditDesc'),
  },
  {
    id: 'versioning',
    label: t('settings.tabs.versioning'),
    icon: History,
    description: t('settings.tabs.versioningDesc'),
  },
  {
    id: 'about',
    label: t('settings.tabs.about'),
    icon: Info,
    description: t('settings.tabs.aboutDesc'),
  },
];

const MarketplaceSettings = ({
  autoUpdateExtensions,
  setAutoUpdateExtensions,
  t,
}: {
  autoUpdateExtensions: boolean;
  setAutoUpdateExtensions: (v: boolean) => void;
  t: (key: string) => string;
}) => (
  <div className="space-y-4">
    <div className="mb-1 px-4 pb-1 pt-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-xp-text-secondary">
        {t('settings.marketplace.updatesSection')}
      </h3>
    </div>
    <SettingRow
      icon={RefreshCw}
      label={t('extensions.autoUpdate')}
      description={t('extensions.autoUpdateDescription')}
    >
      <Toggle
        id="autoUpdateExtensions"
        label={t('extensions.autoUpdate')}
        checked={autoUpdateExtensions}
        onChange={setAutoUpdateExtensions}
      />
    </SettingRow>
  </div>
);

// Manual update entry on the About page: shows the running version and lets
// the user trigger the same check/install flow as the startup auto-check.
const AboutUpdateCard = () => {
  const { t } = useTranslation();
  const { status, checkForUpdate, installUpdate } = useUpdater();
  const [phase, setPhase] = useState<'idle' | 'checking' | 'latest' | 'available' | 'failed'>(
    'idle',
  );

  const handleCheck = async () => {
    setPhase('checking');
    try {
      const update = await checkForUpdate();
      setPhase(update ? 'available' : 'latest');
    } catch {
      setPhase('failed');
    }
  };

  const statusText = () => {
    if (phase === 'checking') return t('updater.checking');
    if (phase === 'latest') return t('updater.upToDate');
    if (phase === 'failed') return t('updater.failed');
    if (phase === 'available' || status.available) {
      return t('updater.available', { version: status.version });
    }
    return t('updater.current', { version: __APP_VERSION__ });
  };

  const renderAction = () => {
    if (status.downloading) {
      return (
        <span className="text-sm text-xp-text-muted" aria-live="polite">
          {t('updater.downloading')} {Math.round(status.progress)}%
        </span>
      );
    }
    if (phase === 'available' || status.available) {
      return (
        <button
          onClick={installUpdate}
          className="inline-flex items-center gap-2 rounded-[2px] bg-xp-blue px-4 py-2 text-sm font-medium text-[var(--xp-bg)] transition-colors hover:bg-xp-blue-dark"
        >
          <Download size={14} />
          {t('updater.install')}
        </button>
      );
    }
    return (
      <button
        onClick={handleCheck}
        disabled={phase === 'checking'}
        className="inline-flex items-center gap-2 rounded-[2px] border border-xp-border bg-xp-surface px-4 py-2 text-sm font-medium text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
      >
        <RefreshCw size={14} className={phase === 'checking' ? 'animate-spin' : ''} />
        {t('updater.checkNow')}
      </button>
    );
  };

  return (
    <div className="rounded-[2px] border border-xp-border p-4">
      <h3 className="mb-3 text-sm font-medium text-xp-text">{t('updater.title')}</h3>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-xp-text-secondary">{statusText()}</p>
        {renderAction()}
      </div>
    </div>
  );
};

const Settings = () => {
  const { t, i18n } = useTranslation();
  const tabs = buildTabs(t);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Window dragging — the native titlebar is overlaid, so the settings header
  // must offer the same drag affordance as the explorer titlebar.
  const appWindowRef = useRef<Awaited<
    ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>
  > | null>(null);
  const isMac = navigator.platform.toUpperCase().includes('MAC');

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      if (!cancelled) appWindowRef.current = getCurrentWindow();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleHeaderMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a, select, textarea, [role="button"]')) {
      return;
    }
    e.preventDefault();
    appWindowRef.current?.startDragging();
  };

  const handleHeaderDoubleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a, select, textarea, [role="button"]')) {
      return;
    }
    appWindowRef.current?.toggleMaximize();
  };

  const [settings, setSettings] = useState<AppSettings>(() => {
    let initialSettings = DEFAULT_SETTINGS;
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        initialSettings = migrateLegacyAiSettings({
          ...DEFAULT_SETTINGS,
          ...JSON.parse(saved),
        });
      }
    } catch {
      /* ignore localStorage/parse errors */
    }

    try {
      const savedUiState = localStorage.getItem(STORAGE_KEYS.UI_STATE);
      if (savedUiState) {
        const uiState = JSON.parse(savedUiState) as { theme?: unknown };
        if (typeof uiState.theme === 'string' && uiState.theme) {
          initialSettings = { ...initialSettings, theme: uiState.theme };
        }
      }
    } catch {
      /* ignore localStorage/parse errors */
    }

    return {
      ...initialSettings,
      language: normalizeLanguage(initialSettings.language),
    };
  });

  const [autoUpdateExtensions, setAutoUpdateExtensions] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AUTO_UPDATE_EXTENSIONS);
      // Default to true if not explicitly set
      return raw === null || raw === 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATE_EXTENSIONS, String(autoUpdateExtensions));
  }, [autoUpdateExtensions]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    // Let the explorer (e.g. hidden-file visibility, ⌘⇧.) follow along live
    window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
  }, [settings]);

  // Stay in sync when settings are changed elsewhere (e.g. the ⌘⇧. shortcut)
  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (!saved) return;
        setSettings((prev) => {
          const merged = migrateLegacyAiSettings({ ...prev, ...JSON.parse(saved) });
          // Avoid re-triggering the persist effect when nothing changed
          return JSON.stringify(merged) === JSON.stringify(prev) ? prev : merged;
        });
      } catch {
        /* ignore localStorage/parse errors */
      }
    };
    window.addEventListener('wisp-settings-changed', syncFromStorage);
    return () => window.removeEventListener('wisp-settings-changed', syncFromStorage);
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.UI_STATE);
      const current = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        STORAGE_KEYS.UI_STATE,
        JSON.stringify({ ...current, theme: settings.theme }),
      );
    } catch {
      localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ theme: settings.theme }));
    }
  }, [settings.theme]);

  useEffect(() => {
    const language = normalizeLanguage(settings.language);
    const activeLanguage = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
    if (activeLanguage !== language) {
      void i18n.changeLanguage(language);
    }
  }, [i18n, settings.language]);

  useEffect(() => {
    loadFontSize();
    if (settings.reducedMotion) document.documentElement.classList.add('reduce-motion');
    if (settings.reduceTransparency) {
      document.documentElement.classList.add('reduce-transparency');
    }
    if (settings.enhancedFocus) document.documentElement.classList.add('enhanced-focus');
    if (settings.highContrast) document.documentElement.classList.add('high-contrast');
    // Mount-only: apply persisted accessibility settings on init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSetting = (key: string, value: string | boolean | number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <GeneralSettings
            settings={settings}
            updateSetting={updateSetting}
            setSettings={setSettings}
          />
        );
      case 'explorer':
        return <ExplorerSettings settings={settings} updateSetting={updateSetting} />;
      case 'file-associations':
        return <FileAssociationsSettings />;
      case 'context-menu':
        return <ContextMenuRulesCard />;
      case 'indexing':
        return (
          <div className="space-y-4 px-4 py-2">
            <TokenizerSettings />
            <SearchProviderSettings settings={settings} updateSetting={updateSetting} />
          </div>
        );
      case 'shortcuts':
        return <ShortcutsSettingsPanel />;
      case 'marketplace':
        return (
          <MarketplaceSettings
            autoUpdateExtensions={autoUpdateExtensions}
            setAutoUpdateExtensions={setAutoUpdateExtensions}
            t={t}
          />
        );
      case 'accessibility':
        return <AccessibilitySettings settings={settings} updateSetting={updateSetting} />;
      case 'backup':
        return <BackupRestoreSettings />;
      case 'audit':
        return <AuditLogSettings />;
      case 'versioning':
        return <VersioningSettings />;
      case 'about':
        return (
          <div className="space-y-4 px-4 py-2">
            <div className="rounded-[2px] border border-xp-border p-6 text-center">
              <h2 className="mb-1 text-2xl font-medium text-xp-text">Wisp</h2>
              <p className="text-sm text-xp-text-muted">v{__APP_VERSION__}</p>
              <p className="mt-3 text-sm text-xp-text-secondary">
                {t('settings.about.description')}
              </p>
            </div>

            {isTauri() && <AboutUpdateCard />}

            <div className="rounded-[2px] border border-xp-border p-4">
              <h3 className="mb-3 text-sm font-medium text-xp-text">{t('settings.about.links')}</h3>
              <div className="space-y-4">
                <button
                  onClick={() => TauriAPI.openUrl('https://github.com/xiixiixixi/wisp')}
                  className="flex w-full items-center gap-3 rounded-[2px] p-2 text-left text-xp-text transition-colors hover:bg-xp-surface-light"
                >
                  <Github size={18} className="text-xp-text-muted" />
                  <span className="text-sm">GitHub Repository</span>
                  <ExternalLink size={14} className="ml-auto text-xp-text-muted" />
                </button>
                <button
                  onClick={() => TauriAPI.openUrl('https://github.com/xiixiixixi/wisp/releases')}
                  className="flex w-full items-center gap-3 rounded-[2px] p-2 text-left text-xp-text transition-colors hover:bg-xp-surface-light"
                >
                  <Github size={18} className="text-xp-text-muted" />
                  <span className="text-sm">Releases</span>
                  <ExternalLink size={14} className="ml-auto text-xp-text-muted" />
                </button>
              </div>
            </div>

            <div className="rounded-[2px] border border-xp-blue/30 bg-xp-blue/5 p-5">
              <div className="flex items-start gap-3">
                <Heart size={20} className="mt-0.5 flex-shrink-0 text-xp-blue" />
                <div>
                  <h3 className="text-sm font-medium text-xp-text">
                    {t('settings.about.sponsorTitle')}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-xp-text-secondary">
                    {t('settings.about.sponsorDescription')}
                  </p>
                  <button
                    onClick={() => TauriAPI.openUrl('https://github.com/sponsors/xiixiixixi')}
                    className="mt-3 inline-flex items-center gap-2 rounded-[2px] bg-xp-blue px-4 py-2 text-sm font-medium text-[var(--xp-bg)] transition-colors hover:bg-xp-blue/80"
                  >
                    <Heart size={14} />
                    {t('settings.about.sponsorButton')}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-center text-xs text-xp-text-muted">{t('settings.about.license')}</p>
          </div>
        );
    }
  };

  return (
    <div className="wisp-settings-shell flex h-screen flex-col overflow-hidden bg-xp-bg text-xp-text">
      {/* Header — draggable window region */}
      <div
        className="wisp-settings-header border-xp-border/50 bg-xp-bg/80 shrink-0 border-b"
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={handleHeaderDoubleClick}
      >
        <div
          className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3 lg:px-8"
          style={isMac ? { paddingLeft: '76px' } : undefined}
        >
          <Link
            href={`/${window.location.search}`}
            className="flex h-8 w-8 items-center justify-center rounded-[2px] text-xp-text-secondary transition-colors hover:bg-xp-surface hover:text-xp-text"
            title={t('settings.backToApp')}
            aria-label={t('settings.backToApp')}
          >
            <ArrowLeft size={18} />
          </Link>
          <img src={wispLogo} alt="" className="h-8 w-8 rounded-[2px]" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-medium leading-tight text-xp-text">
              {t('settings.title')}
            </h1>
            <p className="text-xs text-xp-text-secondary">{t('settings.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Body: Sidebar + Content */}
      <div className="flex-1 overflow-hidden">
        <div className="wisp-settings-layout mx-auto flex h-full max-w-7xl">
          {/* Sidebar — R5 review: 244px, not a wide panel */}
          <nav className="wisp-settings-sidebar scrollbar-none w-[244px] shrink-0 overflow-y-auto px-3 py-4">
            <div className="space-y-4">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-[2px] px-3 py-2.5 text-left transition-all ${
                      isActive
                        ? 'bg-muted text-xp-blue'
                        : 'text-xp-text-secondary hover:bg-xp-surface hover:text-xp-text'
                    }`}
                  >
                    <Icon size={18} className={isActive ? 'text-xp-blue' : ''} />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-sm font-medium ${isActive ? 'text-xp-blue' : ''}`}
                      >
                        {tab.label}
                      </div>
                      <div className="text-xp-text-secondary/60 truncate text-[10px]">
                        {tab.description}
                      </div>
                    </div>
                    {isActive && <ChevronRight size={14} className="shrink-0 text-xp-blue" />}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Content */}
          <main className="wisp-settings-content scrollbar-none flex-1 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl">
              {/* Tab heading */}
              <div className="mb-4 px-4">
                <h2 className="text-xl font-medium text-xp-text">
                  {tabs.find((t) => t.id === activeTab)?.label}
                </h2>
                <p className="mt-0.5 text-sm text-xp-text-secondary">
                  {tabs.find((t) => t.id === activeTab)?.description}
                </p>
              </div>

              {/* Settings content */}
              {renderTabContent()}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default Settings;
