import { useTranslation } from 'react-i18next';
import { useId, useState } from 'react';
import { ChevronRight, Globe, Keyboard, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
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
import AboutSettings from './AboutSettings';
import ShortcutsSettingsPanel from './ShortcutsSettings';
import '@/styles/general-settings.css';

interface GeneralSettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
  setSettings: (s: AppSettings) => void;
}

const GeneralSettings = ({ settings, updateSetting, setSettings }: GeneralSettingsProps) => {
  const { t, i18n } = useTranslation();
  const appearanceId = useId();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const showSystemIntegration = isTauri() && navigator.userAgent.includes('Windows');
  return (
    <div className="wisp-general-settings">
      <div className="wisp-general-preferences">
        <SettingRow
          icon={Monitor}
          label={t('settings.general.appearance')}
          description={t('settings.general.appearanceDesc')}
        >
          <fieldset className="wisp-general-appearance">
            <legend className="sr-only">{t('settings.general.appearance')}</legend>
            {[
              { value: 'system', label: t('settings.general.appearanceSystem'), icon: Monitor },
              { value: 'light', label: t('settings.general.appearanceLight'), icon: Sun },
              { value: 'dark', label: t('settings.general.appearanceDark'), icon: Moon },
            ].map(({ value, label, icon: Icon }) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`appearance-${appearanceId}`}
                  value={value}
                  checked={settings.appearance === value}
                  onChange={() => updateSetting('appearance', value)}
                  className="sr-only"
                />
                <span>
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </span>
              </label>
            ))}
          </fieldset>
        </SettingRow>
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
      <details
        className="wisp-general-disclosure"
        onToggle={(event) => setKeyboardOpen(event.currentTarget.open)}
      >
        <summary>
          <Keyboard size={17} aria-hidden="true" />
          <span>
            <span className="wisp-general-disclosure-title">
              {t('settings.general.keyboard', { defaultValue: 'Keyboard' })}
            </span>
            <span className="wisp-general-disclosure-description">
              {t('settings.general.keyboardDesc', { defaultValue: 'Shortcuts and Vim mode' })}
            </span>
          </span>
          <ChevronRight className="wisp-general-disclosure-chevron" size={14} aria-hidden="true" />
        </summary>
        {keyboardOpen && (
          <div className="wisp-general-disclosure-content wisp-general-keyboard">
            <p className="wisp-general-keyboard-note">
              {t('settings.general.keyboardNote', {
                defaultValue:
                  'On macOS, common shortcuts follow familiar Mac conventions. Wisp also includes shortcuts for its terminal and split panes.',
              })}
            </p>
            <ShortcutsSettingsPanel />
          </div>
        )}
      </details>
      <button
        type="button"
        onClick={() => setSettings(DEFAULT_SETTINGS)}
        className="wisp-general-reset"
      >
        <RotateCcw size={14} aria-hidden="true" />
        {t('settings.resetAll')}
      </button>
      <AboutSettings />
    </div>
  );
};
export default GeneralSettings;
