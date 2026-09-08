import { useTranslation } from 'react-i18next';
import { Globe, RotateCcw } from 'lucide-react';
import { isTauri } from '@/lib/transport';
import { LANGUAGE_OPTIONS, normalizeLanguage } from '@/lib/language-settings';
import {
  SelectField,
  SettingRow,
  SystemIntegrationSettings,
  type AppSettings,
  DEFAULT_SETTINGS,
  SettingsSection,
} from './shared';

interface GeneralSettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
  setSettings: (s: AppSettings) => void;
}

const GeneralSettings = ({ settings, updateSetting, setSettings }: GeneralSettingsProps) => {
  const { t, i18n } = useTranslation();
  const showSystemIntegration = isTauri() && navigator.userAgent.includes('Windows');
  return (
    <div className="space-y-6">
      <div className="content-card rounded-2xl">
        <SettingRow
          icon={Globe}
          label={t('settings.general.language')}
          description={t('settings.general.languageDesc')}
        >
          <SelectField
            label={t('settings.general.language')}
            value={normalizeLanguage(settings.language || i18n.resolvedLanguage || i18n.language)}
            onChange={(value) => {
              updateSetting('language', value);
              void i18n.changeLanguage(value);
            }}
            options={LANGUAGE_OPTIONS}
          />
        </SettingRow>
      </div>
      {showSystemIntegration && (
        <SettingsSection title={t('settings.general.systemIntegration')}>
          <SystemIntegrationSettings />
        </SettingsSection>
      )}
      <div className="px-4 pt-2">
        <button
          type="button"
          onClick={() => setSettings(DEFAULT_SETTINGS)}
          className="flex items-center gap-2 rounded-[2px] px-3 py-2 text-sm text-xp-red transition-colors hover:bg-xp-red/10"
        >
          <RotateCcw size={14} aria-hidden="true" />
          {t('settings.resetAll')}
        </button>
      </div>
    </div>
  );
};
export default GeneralSettings;
