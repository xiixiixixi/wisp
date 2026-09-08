import { useTranslation } from 'react-i18next';
import { LayoutGrid, FileText, FolderOpen, ChevronRight } from 'lucide-react';
import FileAssociationsSettings from './FileAssociationsSettings';
import ContextMenuRulesCard from './ContextMenuRulesCard';
import { Toggle, SelectField, SettingRow, type AppSettings, SettingsSection } from './shared';

interface ExplorerSettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
}

const ExplorerSettings = ({ settings, updateSetting }: ExplorerSettingsProps) => {
  const { t } = useTranslation();

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
      <details className="wisp-settings-disclosure content-card group rounded-2xl">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-xp-text">
          {t('settings.tabs.fileAssociations')}
          <ChevronRight
            size={16}
            className="shrink-0 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="px-2 pb-4">
          <FileAssociationsSettings embedded />
        </div>
      </details>
      <details className="wisp-settings-disclosure content-card group rounded-2xl">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-xp-text">
          {t('settings.tabs.contextMenu')}
          <ChevronRight
            size={16}
            className="shrink-0 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="px-2 pb-4">
          <ContextMenuRulesCard embedded />
        </div>
      </details>
    </div>
  );
};

export default ExplorerSettings;
