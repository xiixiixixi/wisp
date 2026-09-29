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
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface GeneralSettingsProps {
  active?: boolean;
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
  setSettings: (s: AppSettings) => void;
}

const GeneralSettings = ({
  settings,
  updateSetting,
  setSettings,
  active = true,
}: GeneralSettingsProps) => {
  const { t, i18n } = useTranslation();
  const appearanceId = useId();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const resetPreferences = () => {
    setSettings({
      ...settings,
      appearance: DEFAULT_SETTINGS.appearance,
      language: DEFAULT_SETTINGS.language,
      defaultView: DEFAULT_SETTINGS.defaultView,
      showFileExtensions: DEFAULT_SETTINGS.showFileExtensions,
      autoCalculateFolderSizes: DEFAULT_SETTINGS.autoCalculateFolderSizes,
    });
    setConfirmReset(false);
  };
  const showSystemIntegration = isTauri() && navigator.userAgent.includes('Windows');
  return (
    <div className="wisp-general-settings">
      <div className="wisp-general-preferences">
        <SettingRow icon={Monitor} label={t('settings.general.appearance')}>
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
        <SettingRow icon={Globe} label={t('settings.general.language')}>
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
          </span>
          <ChevronRight className="wisp-general-disclosure-chevron" size={14} aria-hidden="true" />
        </summary>
        {keyboardOpen && (
          <div className="wisp-general-disclosure-content wisp-general-keyboard">
            <ShortcutsSettingsPanel active={active} />
          </div>
        )}
      </details>
      <SettingsSection title={t('settings.general.about', { defaultValue: '关于' })}>
        <AboutSettings />
      </SettingsSection>
      <button type="button" className="wisp-general-reset" onClick={() => setConfirmReset(true)}>
        <RotateCcw size={14} aria-hidden="true" />
        {t('settings.resetAll')}
      </button>
      {confirmReset && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmReset(false);
          }}
          maxWidth={420}
        >
          <div className="wisp-settings-confirm">
            <DialogTitle>{t('settings.general.resetConfirmTitle')}</DialogTitle>
            <p>{t('settings.general.resetDescription')}</p>
            <div className="wisp-settings-actions">
              <Button variant="secondary" data-autofocus onClick={() => setConfirmReset(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={resetPreferences}>{t('settings.general.resetConfirm')}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
export default GeneralSettings;
