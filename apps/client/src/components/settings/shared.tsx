import { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { DEFAULT_LANGUAGE } from '@/lib/language-settings';
import { Monitor, FolderOpen, AlertTriangle } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { TauriAPI } from '@/lib/tauri-api';

/** A toggle switch matching the original settings.tsx Toggle. */
export const Toggle = ({
  checked,
  onChange,
  id,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
  label?: string;
}) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-xp-bg ${
      checked ? 'bg-xp-selection' : 'bg-xp-border'
    }`}
    onClick={() => onChange(!checked)}
  >
    <span
      className={`pointer-events-none inline-block h-4 w-4 rounded transition-all ${
        checked ? 'translate-x-5 bg-xp-text' : 'translate-x-0.5 bg-xp-text-muted'
      }`}
    />
  </button>
);

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
}) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="h-8 w-44" aria-label={label}>
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

/**
 * A grouped settings card: glass panel with a heading, rows separated by
 * hairlines. The standard container for every settings group — rows go
 * inside as SettingRow children.
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
  <section className="glass-card rounded-xl p-1">
    <div className="px-3 pb-1 pt-2.5">
      <h3 className="text-[13px] font-medium text-xp-text">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-xp-text-secondary">{description}</p>}
    </div>
    <div className="divide-xp-border/40 divide-y">{children}</div>
  </section>
);

/** A single setting row: icon + label/desc on the left, control on the right. */
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
}) => (
  <div className="group flex items-center justify-between gap-4 rounded-md px-3 py-3 transition-colors hover:bg-xp-surface-light/50">
    <div className="flex min-w-0 items-center gap-3">
      {Icon && <Icon size={17} className="shrink-0 text-xp-text-secondary" />}
      <div className="min-w-0">
        <div className="text-sm font-medium text-xp-text">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs leading-relaxed text-xp-text-secondary">{description}</div>
        )}
      </div>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

/** Section heading. */
export const SectionTitle = ({ title, description }: { title: string; description?: string }) => (
  <div className="mb-1 px-4 pb-1 pt-2">
    <h3 className="text-xs font-medium uppercase tracking-wider text-xp-text-secondary">{title}</h3>
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
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-8 shrink-0 cursor-pointer rounded border-none bg-transparent p-0"
      style={{ WebkitAppearance: 'none' }}
    />
    <input
      type="text"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (/^#[0-9a-fA-F]{0,6}$/.test(v) || v === '') onChange(v || '#000000');
      }}
      className="w-[90px] rounded border border-xp-border bg-xp-bg px-2 py-1 font-mono text-xs text-xp-text"
    />
  </div>
);

/** Permission toggle button (ON/OFF). */
export const PermToggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
  <button
    type="button"
    onClick={onChange}
    className={`rounded-md px-3 py-1 text-xs font-medium tracking-wide transition-all ${
      enabled
        ? 'border border-xp-green/40 bg-xp-green/10 text-xp-green hover:bg-xp-green/20'
        : 'border border-xp-red/20 bg-xp-red/10 text-xp-red hover:bg-xp-red/20'
    }`}
  >
    {enabled ? 'ON' : 'OFF'}
  </button>
);

/** Windows-only system integration settings (default/context-menu handler). */
export const SystemIntegrationSettings = () => {
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
  if (loading) return <div className="px-4 py-2 text-sm text-xp-text-muted">Loading...</div>;

  return (
    <>
      <SettingRow
        icon={Monitor}
        label="Default File Explorer"
        description="Double-clicking folders opens Wisp instead of Windows Explorer"
      >
        <Toggle
          id="defaultExplorer"
          label="Default Explorer"
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
        label="Folder Context Menu"
        description="Add 'Open with Wisp' to folder right-click menu"
      >
        <Toggle
          id="contextMenu"
          label="Context Menu"
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
          Folders will open in Wisp. Disable to restore Windows Explorer.
        </div>
      )}
    </>
  );
};

// ── Shared types ──────────────────────────────────────────────────

export interface AppSettings {
  theme: string;
  language: string;
  showHiddenFiles: boolean;
  enableMarkdownPreview: boolean;
  defaultView: string;
  enableAnimations: boolean;
  showFileExtensions: boolean;
  enableNotifications: boolean;
  autoSave: boolean;
  fontSize: string;
  sidebarWidth: string;
  reducedMotion: boolean;
  enhancedFocus: boolean;
  highContrast: boolean;
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
  weatherSync: boolean;
}

/**
 * The "Wisp 云（免费）" chat mode was a dead shell (its backend only reads
 * an OPENROUTER_API_KEY env var that no UI ever sets). Legacy profiles that
 * still carry aiServiceMode 'cloud' are migrated to 'custom' on load.
 */
export const migrateLegacyAiSettings = <T extends { aiServiceMode?: string; theme?: string }>(
  s: T,
): T => {
  const migrated = s.aiServiceMode === 'cloud' ? { ...s, aiServiceMode: 'custom' } : { ...s };
  // The three legacy themes collapsed into the single adaptive theme.
  if (migrated.theme && migrated.theme !== 'auto') {
    return { ...migrated, theme: 'auto' };
  }
  return migrated;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'auto',
  language: DEFAULT_LANGUAGE,
  showHiddenFiles: false,
  enableMarkdownPreview: true,
  defaultView: 'details',
  enableAnimations: true,
  showFileExtensions: true,
  enableNotifications: true,
  autoSave: true,
  fontSize: 'medium',
  sidebarWidth: 'medium',
  reducedMotion: false,
  enhancedFocus: false,
  highContrast: false,
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
  weatherSync: true,
};

export const SETTINGS_KEY = STORAGE_KEYS.SETTINGS;
