import { useState, useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2, FolderOpen, X } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import GeneralSettings from '@/components/settings/GeneralSettings';
import ExplorerSettings from '@/components/settings/ExplorerSettings';
import { applyTheme } from '@/lib/utils';
import { normalizeLanguage } from '@/lib/language-settings';
import { applyAppearance, normalizeAppearance } from '@/lib/appearance';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  migrateLegacyAiSettings,
} from '@/components/settings/shared';
import '@/components/settings/settings-dialog.css';

type SettingsTab = 'general' | 'explorer';

interface SettingsProps {
  onClose?: () => void;
}

const Settings = ({ onClose }: SettingsProps) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const tabs = [
    { id: 'general' as const, label: t('settings.tabs.general'), icon: Settings2 },
    { id: 'explorer' as const, label: t('settings.tabs.explorer'), icon: FolderOpen },
  ];
  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = 1;
    if (next === null) return;
    event.preventDefault();
    selectTab(tabs[next].id);
    document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
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
      appearance: normalizeAppearance(initialSettings.appearance),
      language: normalizeLanguage(initialSettings.language),
    };
  });

  useEffect(() => {
    try {
      const serialized = JSON.stringify(settings);
      // A storage event may already contain this state from another window.
      if (localStorage.getItem(SETTINGS_KEY) !== serialized) {
        localStorage.setItem(SETTINGS_KEY, serialized);
      }
    } catch {
      /* Keep in-memory preferences usable when storage is unavailable. */
    }
    // Let the explorer (e.g. hidden-file visibility, ⌘⇧.) follow along live
    window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
  }, [settings]);

  useEffect(() => {
    applyAppearance(settings.appearance);
  }, [settings.appearance]);

  // Stay in sync when settings are changed elsewhere (e.g. the ⌘⇧. shortcut)
  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        const parsed = saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
        setSettings((prev) => {
          const merged = migrateLegacyAiSettings({
            ...prev,
            ...parsed,
            appearance: normalizeAppearance(parsed?.appearance),
          });
          // Avoid re-triggering the persist effect when nothing changed
          return JSON.stringify(merged) === JSON.stringify(prev) ? prev : merged;
        });
      } catch {
        /* ignore localStorage/parse errors */
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_KEY || event.key === null) syncFromStorage();
    };
    window.addEventListener('wisp-settings-changed', syncFromStorage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('wisp-settings-changed', syncFromStorage);
      window.removeEventListener('storage', handleStorage);
    };
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

  const updateSetting = (key: string, value: string | boolean | number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
      maxWidth={660}
    >
      <div className="wisp-settings-dialog">
        <header className="wisp-settings-dialog-header">
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <button
            type="button"
            className="wisp-control-icon wisp-settings-close"
            aria-label={t('settings.close')}
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div className="wisp-settings-tabbar" role="tablist" aria-label={t('settings.categories')}>
          {tabs.map(({ id: tab, label, icon: Icon }, index) => (
            <button
              type="button"
              key={tab}
              id={`${id}-tab-${tab}`}
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`${id}-panel-${tab}`}
              tabIndex={activeTab === tab ? 0 : -1}
              data-autofocus={activeTab === tab ? '' : undefined}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div
          ref={contentRef}
          className="wisp-settings-dialog-body"
          id={`${id}-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === 'general' ? (
            <GeneralSettings
              settings={settings}
              updateSetting={updateSetting}
              setSettings={setSettings}
            />
          ) : (
            <ExplorerSettings settings={settings} updateSetting={updateSetting} />
          )}
        </div>
        <footer className="wisp-settings-dialog-footer">{t('settings.savedAutomatically')}</footer>
      </div>
    </Dialog>
  );
};

export default Settings;
