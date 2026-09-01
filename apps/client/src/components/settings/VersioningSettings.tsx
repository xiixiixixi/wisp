import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { History, FolderOpen, Plus, Trash2, Save } from 'lucide-react';
import { SettingRow, Toggle, SelectField, SettingsSection } from './shared';
import { TauriAPI, type VersioningConfig } from '@/lib/tauri-api';

const VersioningSettings = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<VersioningConfig>({
    enabled_dirs: [],
    max_versions_per_file: 10,
    auto_version_on_save: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDir, setNewDir] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await TauriAPI.getVersioningConfig();
      setConfig(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      await TauriAPI.updateVersioningConfig(config);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addDirectory = async () => {
    const dir = newDir.trim();
    if (!dir) return;
    const normalized = dir.replace(/\\/g, '/');
    if (config.enabled_dirs.some((d) => d.replace(/\\/g, '/') === normalized)) return;

    try {
      await TauriAPI.enableVersioning(dir);
      setConfig((prev) => ({
        ...prev,
        enabled_dirs: [...prev.enabled_dirs, dir],
      }));
      setNewDir('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeDirectory = async (dir: string) => {
    try {
      await TauriAPI.disableVersioning(dir);
      setConfig((prev) => ({
        ...prev,
        enabled_dirs: prev.enabled_dirs.filter((d) => d !== dir),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-xp-accent border-t-transparent" />
        <span className="ml-3 text-sm text-xp-text-secondary">
          {t('settings.versioning.loadingSettings')}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsSection
        title={t('settings.versioning.fileVersioningSection')}
        description={t('settings.versioning.fileVersioningSectionDesc')}
      >
        {error && (
          <div className="mx-4 mb-2 rounded-md border border-xp-red/20 bg-xp-red/10 px-3 py-2 text-xs text-xp-red">
            {error}
          </div>
        )}

        <SettingRow
          icon={Save}
          label={t('settings.versioning.autoVersionLabel')}
          description={t('settings.versioning.autoVersionDesc')}
        >
          <Toggle
            id="auto-version"
            checked={config.auto_version_on_save}
            onChange={(v) => {
              setConfig((prev) => ({ ...prev, auto_version_on_save: v }));
              setDirty(true);
            }}
          />
        </SettingRow>

        <SettingRow
          icon={History}
          label={t('settings.versioning.maxVersionsLabel')}
          description={t('settings.versioning.maxVersionsDesc')}
        >
          <SelectField
            value={String(config.max_versions_per_file)}
            onChange={(v) => {
              setConfig((prev) => ({ ...prev, max_versions_per_file: parseInt(v, 10) }));
              setDirty(true);
            }}
            options={[
              { value: '5', label: '5' },
              { value: '10', label: '10' },
              { value: '20', label: '20' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
            ]}
          />
        </SettingRow>

        {dirty && (
          <div className="px-4 pb-2">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-xp-accent/10 px-3 py-1.5 text-xs font-medium text-xp-accent transition-colors hover:bg-xp-accent/20 disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? t('settings.versioning.saving') : t('settings.versioning.saveChanges')}
            </button>
          </div>
        )}
      </SettingsSection>
      <SettingsSection
        title={t('settings.versioning.trackedDirsSection')}
        description={t('settings.versioning.trackedDirsSectionDesc')}
      >
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newDir}
              onChange={(e) => setNewDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addDirectory();
              }}
              placeholder={t('settings.versioning.dirPlaceholder')}
              className="placeholder:text-xp-text-secondary/50 h-9 flex-1 rounded-md border border-xp-border bg-xp-bg px-3 text-sm text-xp-text focus:outline-none focus:ring-1 focus:ring-xp-accent"
            />
            <button
              onClick={addDirectory}
              disabled={!newDir.trim()}
              className="flex h-9 items-center gap-1.5 rounded-md bg-xp-accent/10 px-3 text-xs font-medium text-xp-accent transition-colors hover:bg-xp-accent/20 disabled:opacity-50"
            >
              <Plus size={14} />
              {t('settings.versioning.addDir')}
            </button>
          </div>
        </div>

        {config.enabled_dirs.length === 0 ? (
          <div className="px-4 py-4 text-center">
            <FolderOpen size={24} className="text-xp-text-secondary/40 mx-auto mb-2" />
            <p className="text-xs text-xp-text-secondary">
              {t('settings.versioning.noDirsTracked')}
            </p>
            <p className="text-xp-text-secondary/60 mt-0.5 text-[11px]">
              {t('settings.versioning.noDirsTrackedHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-2">
            {config.enabled_dirs.map((dir) => (
              <div
                key={dir}
                className="border-xp-border/30 flex items-center justify-between gap-2 rounded-md border bg-xp-surface/50 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FolderOpen size={14} className="shrink-0 text-xp-text-secondary" />
                  <span className="truncate text-xs text-xp-text" title={dir}>
                    {dir}
                  </span>
                </div>
                <button
                  onClick={() => removeDirectory(dir)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xp-text-secondary transition-colors hover:bg-xp-red/10 hover:text-xp-red"
                  title={t('settings.versioning.stopTracking')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
};

export default VersioningSettings;
