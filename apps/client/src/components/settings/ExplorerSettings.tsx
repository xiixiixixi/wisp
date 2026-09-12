import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, FileText, FolderOpen, ChevronRight } from 'lucide-react';
import ContextMenuRulesCard from './ContextMenuRulesCard';
import { getContextMenuRules } from '@/lib/context-menu-rules';
import { Toggle, SelectField, SettingRow, type AppSettings, SettingsSection } from './shared';

interface ExplorerSettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
}

const ExplorerSettings = ({ settings, updateSetting }: ExplorerSettingsProps) => {
  const { t } = useTranslation();
  // Keep a recovery path for existing rules without showing an empty rule editor.
  const [hasCustomRules] = useState(() => getContextMenuRules().length > 0);

  const viewModes = [
    { value: 'auto', label: t('settings.explorer.auto') },
    { value: 'grid', label: t('settings.explorer.grid') },
    { value: 'list', label: t('settings.explorer.list') },
    { value: 'details', label: t('settings.explorer.details') },
  ];

  return (
    <div className="space-y-4">
      <SettingsSection title={t('settings.explorer.display')}>
        <SettingRow
          icon={LayoutGrid}
          label={t('settings.explorer.defaultView')}
          description={t('settings.explorer.defaultViewDesc')}
        >
          <SelectField
            label={t('settings.explorer.defaultView')}
            value={settings.defaultView}
            onChange={(v) => updateSetting('defaultView', v)}
            options={viewModes}
          />
        </SettingRow>
        <SettingRow
          icon={FileText}
          label={t('settings.explorer.fileExtensions')}
          description={t('settings.explorer.fileExtensionsDesc')}
        >
          <Toggle
            id="fileExtensions"
            label={t('settings.explorer.fileExtensions')}
            checked={settings.showFileExtensions}
            onChange={(v) => updateSetting('showFileExtensions', v)}
          />
        </SettingRow>
        <SettingRow
          icon={FolderOpen}
          label={t('settings.explorer.autoFolderSizes')}
          description={t('settings.explorer.autoFolderSizesDesc')}
        >
          <Toggle
            id="autoFolderSizes"
            label={t('settings.explorer.autoFolderSizes')}
            checked={settings.autoCalculateFolderSizes}
            onChange={(v) => updateSetting('autoCalculateFolderSizes', v)}
          />
        </SettingRow>
      </SettingsSection>
      {hasCustomRules && (
        <details className="wisp-settings-advanced">
          <summary>
            <ChevronRight size={14} aria-hidden="true" />
            {t('settings.explorer.advanced')}
          </summary>
          <div className="wisp-settings-advanced-body">
            <SettingsSection title={t('settings.explorer.contextMenuVisibility')}>
              <p className="wisp-settings-advanced-description">
                {t('settings.explorer.contextMenuVisibilityDesc')}
              </p>
              <ContextMenuRulesCard embedded />
            </SettingsSection>
          </div>
        </details>
      )}
    </div>
  );
};

export default ExplorerSettings;
