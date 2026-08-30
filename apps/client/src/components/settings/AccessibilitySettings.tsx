import { useTranslation } from 'react-i18next';
import { Sparkles, Monitor, Eye } from 'lucide-react';
import { Toggle, SettingRow, type AppSettings, SettingsSection } from './shared';

interface AccessibilitySettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
}

const AccessibilitySettings = ({ settings, updateSetting }: AccessibilitySettingsProps) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <SettingsSection title={t('settings.accessibility.motion')}>
        <SettingRow
          icon={Sparkles}
          label={t('settings.accessibility.reduceMotion')}
          description={t('settings.accessibility.reduceMotionDesc')}
        >
          <Toggle
            id="reducedMotion"
            label={t('settings.accessibility.reduceMotion')}
            checked={settings.reducedMotion}
            onChange={(v) => {
              updateSetting('reducedMotion', v);
              document.documentElement.classList.toggle('reduce-motion', v);
            }}
          />
        </SettingRow>
      </SettingsSection>{' '}
      <SettingsSection title={t('settings.accessibility.focus')}>
        <SettingRow
          icon={Monitor}
          label={t('settings.accessibility.enhancedFocus')}
          description={t('settings.accessibility.enhancedFocusDesc')}
        >
          <Toggle
            id="enhancedFocus"
            label={t('settings.accessibility.enhancedFocus')}
            checked={settings.enhancedFocus}
            onChange={(v) => {
              updateSetting('enhancedFocus', v);
              document.documentElement.classList.toggle('enhanced-focus', v);
            }}
          />
        </SettingRow>
      </SettingsSection>{' '}
      <SettingsSection title={t('settings.accessibility.contrast')}>
        <SettingRow
          icon={Eye}
          label={t('settings.accessibility.highContrast')}
          description={t('settings.accessibility.highContrastDesc')}
        >
          <Toggle
            id="highContrast"
            label={t('settings.accessibility.highContrast')}
            checked={settings.highContrast}
            onChange={(v) => {
              updateSetting('highContrast', v);
              document.documentElement.classList.toggle('high-contrast', v);
            }}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
};

export default AccessibilitySettings;
