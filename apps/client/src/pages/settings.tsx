import { useState, useEffect, useId, useRef, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2, FolderOpen, Bot, X, Plug } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { SettingsDraftState } from '@/components/settings/draft-state';
import GeneralSettings from '@/components/settings/GeneralSettings';
import ExplorerSettings from '@/components/settings/ExplorerSettings';
import AiModelSettings from '@/components/settings/AiModelSettings';
import McpSettings from '@/components/settings/McpSettings';
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

type SettingsTab = 'general' | 'explorer' | 'ai' | 'mcp';

interface SettingsProps {
  onClose?: () => void;
}

const Settings = ({ onClose }: SettingsProps) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [visitedTabs, setVisitedTabs] = useState<SettingsTab[]>(['general']);
  const [drafts, setDrafts] = useState<Record<string, SettingsDraftState>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const hasDraft = Object.values(drafts).some((draft) => draft.dirty);
  const busy = Object.values(drafts).some((draft) => draft.busy);
  const updateAiDraft = useCallback(
    (state: SettingsDraftState) => setDrafts((prev) => ({ ...prev, ai: state })),
    [],
  );
  const updateMcpDraft = useCallback(
    (state: SettingsDraftState) => setDrafts((prev) => ({ ...prev, mcp: state })),
    [],
  );
  const requestClose = () => {
    if (hasDraft || busy || saveError) setConfirmClose(true);
    else onClose?.();
  };
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const tabs = [
    { id: 'general' as const, label: t('settings.tabs.general'), icon: Settings2 },
    { id: 'explorer' as const, label: t('settings.tabs.explorer'), icon: FolderOpen },
    { id: 'ai' as const, label: t('settings.tabs.ai'), icon: Bot },
    { id: 'mcp' as const, label: t('settings.tabs.mcp'), icon: Plug },
  ];
  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = (index - 1 + tabs.length) % tabs.length;
    }
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
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
      setSaveError(false);
      // Only announce persisted preferences; a failed write must not reload stale values.
      window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
    } catch {
      setSaveError(true);
    }
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
      // The preference status already reports unavailable device storage.
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

  const panels = {
    general: (
      <GeneralSettings
        active={activeTab === 'general' && !confirmClose}
        settings={settings}
        updateSetting={updateSetting}
        setSettings={setSettings}
      />
    ),
    explorer: <ExplorerSettings settings={settings} updateSetting={updateSetting} />,
    mcp: <McpSettings onDraftChange={updateMcpDraft} />,
    ai: <AiModelSettings onDraftChange={updateAiDraft} />,
  };
  let statusKey: string | null = null;
  if (hasDraft) statusKey = 'settings.unsavedDraft';
  if (busy) statusKey = 'settings.saving';
  if (saveError) statusKey = 'settings.saveFailed';

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
        maxWidth={720}
      >
        <div className="wisp-settings-dialog wisp-settings-root elevated-glass">
          <header className="wisp-settings-dialog-header">
            <DialogTitle>{t('settings.title')}</DialogTitle>
            <button
              type="button"
              className="wisp-control-icon wisp-settings-close"
              aria-label={t('settings.close')}
              onClick={requestClose}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <div className="wisp-settings-split flex min-h-0 flex-1">
            {/* Settings navigation stays separate from the grouped form content. */}
            <nav
              className="wisp-settings-nav wisp-no-select flex w-[188px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-xp-border px-2 pb-3 pt-1"
              role="tablist"
              aria-label={t('settings.categories')}
              aria-orientation="vertical"
            >
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
                  className="wisp-settings-category"
                  data-settings-nav={tab}
                >
                  <Icon size={16} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 truncate">{label}</span>
                </button>
              ))}
            </nav>

            <div ref={contentRef} className="wisp-settings-dialog-body min-w-0 flex-1">
              {visitedTabs.map((tab) => (
                <div
                  key={tab}
                  hidden={activeTab !== tab}
                  id={`${id}-panel-${tab}`}
                  role="tabpanel"
                  aria-labelledby={`${id}-tab-${tab}`}
                  tabIndex={0}
                >
                  {panels[tab]}
                </div>
              ))}
            </div>
          </div>
          {statusKey && (
            <footer className="wisp-settings-dialog-footer" role={saveError ? 'alert' : 'status'}>
              {t(statusKey)}
              {saveError && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSettings((prev) => ({ ...prev }))}
                >
                  {t('settings.retry')}
                </Button>
              )}
            </footer>
          )}
        </div>
      </Dialog>
      {confirmClose && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmClose(false);
          }}
          maxWidth={420}
        >
          <div className="wisp-settings-confirm">
            <DialogTitle>{t(busy ? 'settings.saving' : 'settings.discardTitle')}</DialogTitle>
            <p>{t(busy ? 'settings.waitForSave' : 'settings.discardDescription')}</p>
            <div className="wisp-settings-actions">
              <Button variant="secondary" onClick={() => setConfirmClose(false)} data-autofocus>
                {t('settings.keepEditing')}
              </Button>
              {!busy && <Button onClick={onClose}>{t('settings.discardAndClose')}</Button>}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
};

export default Settings;
