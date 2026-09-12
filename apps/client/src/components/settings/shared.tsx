import { useTranslation } from 'react-i18next';
import { createContext, useContext, useId, useState, useEffect } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { DEFAULT_LANGUAGE } from '@/lib/language-settings';
import { stripRetiredSettings } from '@/lib/retired-settings';
import type { AppearancePreference } from '@/lib/appearance';
import { Monitor, FolderOpen, AlertTriangle } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { TauriAPI } from '@/lib/tauri-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SettingLabelContext = createContext<{
  labelId: string;
  descriptionId?: string;
} | null>(null);

/** System switch with a persistent accessible label in a settings row. */
export const Toggle = ({
  checked,
  onChange,
  id,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
  label?: string;
  disabled?: boolean;
}) => {
  const row = useContext(SettingLabelContext);
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={label ? undefined : row?.labelId}
      aria-describedby={row?.descriptionId}
      disabled={disabled}
      className={`liquid-toggle relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-[background-color,box-shadow,opacity] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-[var(--ds-accent)]' : 'bg-[var(--ds-fill)]'
      }`}
      onClick={() => onChange(!checked)}
    >
      <span
        aria-hidden="true"
        className={`liquid-toggle-thumb pointer-events-none inline-block h-4 w-4 rounded-full bg-white transition-transform motion-reduce:transition-none ${
          checked ? 'translate-x-[17px]' : 'translate-x-px'
        }`}
      />
    </button>
  );
};

/** A select dropdown field. */
export const SelectField = ({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) => {
  const row = useContext(SettingLabelContext);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="w-44 max-w-full"
        aria-label={label}
        aria-labelledby={label ? undefined : row?.labelId}
        aria-describedby={row?.descriptionId}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/**
 * A grouped settings surface with a heading and inset row separators.
 */
export const SettingsSection = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <section className="content-card rounded-xl p-1">
    <div className="px-3 pb-2 pt-3">
      <h3 className="text-[13px] font-semibold text-xp-text">{title}</h3>
      {description && (
        <p className="mt-1 text-xs leading-[1.4] text-xp-text-secondary">{description}</p>
      )}
    </div>
    <div className="divide-xp-border/40 divide-y">{children}</div>
  </section>
);

/** A setting label and control share a row and accessible label association. */
export const SettingRow = ({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon?: React.ElementType;
  label: string;
  description?: string;
  children: React.ReactNode;
}) => {
  const id = useId();
  const labelId = `setting-label-${id}`;
  const descriptionId = description ? `setting-description-${id}` : undefined;
  return (
    <div className="wisp-setting-row group flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-3 py-2.5 sm:flex-nowrap">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && <Icon size={17} className="shrink-0 text-xp-text-secondary" aria-hidden="true" />}
        <div className="min-w-0">
          <div id={labelId} className="text-[13px] font-normal leading-4 text-xp-text">
            {label}
          </div>
          {description && (
            <div id={descriptionId} className="mt-1 text-xs leading-[1.4] text-xp-text-secondary">
              {description}
            </div>
          )}
        </div>
      </div>
      <SettingLabelContext.Provider value={{ labelId, descriptionId }}>
        <div className="max-w-full shrink-0">{children}</div>
      </SettingLabelContext.Provider>
    </div>
  );
};

/** Section heading. */
export const SectionTitle = ({ title, description }: { title: string; description?: string }) => (
  <div className="mb-1 px-4 pb-1 pt-2">
    <h3 className="text-[13px] font-semibold leading-5 text-xp-text">{title}</h3>
    {description && <p className="text-xp-text-secondary/70 mt-0.5 text-xs">{description}</p>}
  </div>
);

/** Horizontal divider. */
export const Divider = () => <div className="bg-xp-border/50 mx-4 my-2 h-px" />;

/** A single color picker field: label + native color input + hex text input. */
export const ColorField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) => (
  <div className="mb-2 flex items-center gap-2">
    <span className="w-[120px] shrink-0 text-[13px] text-xp-text-secondary">{label}</span>
    <input
      type="color"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-7 shrink-0 cursor-pointer rounded-md border border-xp-border bg-transparent p-0.5 focus-visible:outline-none"
      style={{ WebkitAppearance: 'none' }}
    />
    <Input
      type="text"
      aria-label={`${label} (Hex)`}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (/^#[0-9a-fA-F]{0,6}$/.test(v) || v === '') onChange(v || '#000000');
      }}
      className="w-[90px] font-mono text-xs"
    />
  </div>
);

/** Permission toggle button (ON/OFF). */
export const PermToggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => {
  const { t: tUi } = useTranslation();
  const row = useContext(SettingLabelContext);
  return (
    <Button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-labelledby={row?.labelId}
      aria-describedby={row?.descriptionId}
      onClick={onChange}
      variant={enabled ? 'default' : 'secondary'}
      size="sm"
      className="min-w-11"
    >
      {enabled ? tUi('common.on') : tUi('common.off')}
    </Button>
  );
};

/** Windows-only system integration settings (default/context-menu handler). */
export const SystemIntegrationSettings = () => {
  const { t: tUi } = useTranslation();
  const [isDefaultHandler, setIsDefaultHandler] = useState(false);
  const [contextMenuInstalled, setContextMenuInstalled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isWindows] = useState(() => navigator.userAgent.includes('Windows'));

  useEffect(() => {
    if (!isWindows) {
      setLoading(false);
      return;
    }
    TauriAPI.getShellIntegrationStatus()
      .then((status) => {
        setIsDefaultHandler(status.is_default_handler);
        setContextMenuInstalled(status.context_menu_installed);
      })
      .catch((err: unknown) => console.warn('Failed to get shell integration status:', err))
      .finally(() => setLoading(false));
  }, [isWindows]);

  if (!isWindows) return null;
  if (loading) {
    return (
      <div className="px-4 py-2 text-sm text-xp-text-muted">{tUi('panels.notes.loading')}</div>
    );
  }

  return (
    <>
      <SettingRow
        icon={Monitor}
        label={tUi('settings.general.defaultExplorer')}
        description={tUi('settings.general.defaultExplorerDesc')}
      >
        <Toggle
          id="defaultExplorer"
          label={tUi('settings.general.defaultExplorerToggle')}
          checked={isDefaultHandler}
          onChange={async (v) => {
            try {
              await TauriAPI.setDefaultFolderHandler(v);
              setIsDefaultHandler(v);
              if (v && !contextMenuInstalled) {
                setContextMenuInstalled(true);
              }
            } catch (err) {
              console.error('Failed to set default handler:', err);
            }
          }}
        />
      </SettingRow>
      <SettingRow
        icon={FolderOpen}
        label={tUi('settings.general.folderContextMenu')}
        description={tUi('settings.general.folderContextMenuDesc')}
      >
        <Toggle
          id="contextMenu"
          label={tUi('settings.general.contextMenuToggle')}
          checked={contextMenuInstalled}
          onChange={async (v) => {
            try {
              if (v) {
                await TauriAPI.addContextMenuEntry();
              } else {
                await TauriAPI.removeContextMenuEntry();
                if (isDefaultHandler) {
                  await TauriAPI.setDefaultFolderHandler(false);
                  setIsDefaultHandler(false);
                }
              }
              setContextMenuInstalled(v);
            } catch (err) {
              console.error('Failed to toggle context menu:', err);
            }
          }}
        />
      </SettingRow>
      {isDefaultHandler && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-xp-yellow">
          <AlertTriangle size={12} />
          {tUi('settings.general.explorerWarning')}
        </div>
      )}
    </>
  );
};

// ── Shared types ──────────────────────────────────────────────────

export interface AppSettings {
  theme: string;
  appearance: AppearancePreference;
  language: string;
  showHiddenFiles: boolean;
  defaultView: string;
  showFileExtensions: boolean;
  autoCalculateFolderSizes: boolean;
  rememberViewPerFolder: boolean;
  aiSearchProvider: string;
  aiSearchModel: string;
  aiSearchApiKey: string;
  aiServiceMode: 'cloud' | 'custom';
  aiCloudModel: string;
  aiCustomProvider: string;
  aiCustomModel: string;
  aiCustomApiKey: string;
  aiCustomEndpoint: string;
  aiCustomProtocol: 'openai' | 'anthropic';
  weatherCity: string;
  weatherLat: number;
  weatherLon: number;
}

/**
 * The "Wisp 云（免费）" chat mode was a dead shell (its backend only reads
 * an OPENROUTER_API_KEY env var that no UI ever sets). Legacy profiles that
 * still carry aiServiceMode 'cloud' are migrated to 'custom' on load.
 */
export const migrateLegacyAiSettings = <T extends { aiServiceMode?: string; theme?: string }>(
  s: T,
): T => {
  const migrated = stripRetiredSettings(
    s.aiServiceMode === 'cloud' ? { ...s, aiServiceMode: 'custom' } : { ...s },
  );
  // The three legacy themes collapsed into the single adaptive theme.
  if (migrated.theme && migrated.theme !== 'auto') {
    return { ...migrated, theme: 'auto' };
  }
  return migrated;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'auto',
  appearance: 'system',
  language: DEFAULT_LANGUAGE,
  showHiddenFiles: false,
  defaultView: 'details',
  showFileExtensions: true,
  autoCalculateFolderSizes: false,
  rememberViewPerFolder: false,
  aiSearchProvider: 'auto',
  aiSearchModel: '',
  aiSearchApiKey: '',
  aiServiceMode: 'custom',
  aiCloudModel: 'anthropic/claude-sonnet-4',
  aiCustomProvider: 'ollama',
  aiCustomModel: '',
  aiCustomApiKey: '',
  aiCustomEndpoint: '',
  aiCustomProtocol: 'openai',
  weatherCity: '上海',
  weatherLat: 31.2304,
  weatherLon: 121.4737,
};

export const SETTINGS_KEY = STORAGE_KEYS.SETTINGS;
