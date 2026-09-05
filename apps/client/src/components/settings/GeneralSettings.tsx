import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import {
  CloudSun,
  Globe,
  Type,
  Sparkles,
  PanelLeft,
  Bell,
  Save,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';
import { startTour, resetTourCompleted } from '@/hooks/use-tour';
import { applyFontSize } from '@/lib/utils';
import { TauriAPI } from '@/lib/tauri-api';
import { useWeather } from '@/hooks/use-weather';
import { describeWeatherCode } from '@/lib/weather';
import { normalizeLanguage } from '@/lib/language-settings';
import {
  Toggle,
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

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'id', label: 'Bahasa Indonesia' },
];

const GeneralSettings = ({ settings, updateSetting, setSettings }: GeneralSettingsProps) => {
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const weatherReport = useWeather().report;

  const handleWeatherCitySave = async (e: React.FocusEvent<HTMLInputElement>) => {
    const city = e.target.value.trim();
    if (!city || city === settings.weatherCity) return;
    setWeatherStatus('saving');
    try {
      const places = await TauriAPI.geocodeCity(city);
      if (places.length === 0) {
        setWeatherStatus('error');
        return;
      }
      updateSetting('weatherCity', places[0].name);
      updateSetting('weatherLat', places[0].latitude);
      updateSetting('weatherLon', places[0].longitude);
      setWeatherStatus('ok');
    } catch {
      setWeatherStatus('error');
    }
  };
  const [, setLocation] = useLocation();
  const { t, i18n } = useTranslation();
  const fontSizes = [
    { value: 'small', label: t('settings.general.small') },
    { value: 'medium', label: t('settings.general.medium') },
    { value: 'large', label: t('settings.general.large') },
    { value: 'xl', label: t('settings.general.extraLarge') },
  ];

  const sidebarWidths = [
    { value: 'narrow', label: t('settings.general.narrow') },
    { value: 'medium', label: t('settings.general.medium') },
    { value: 'wide', label: t('settings.general.wide') },
  ];

  return (
    <div className="space-y-6">
      <SettingsSection title={t('settings.general.appearance')}>
        <SettingRow
          icon={Globe}
          label={t('settings.general.language')}
          description={t('settings.general.languageDesc')}
        >
          <SelectField
            label={t('settings.general.language')}
            value={normalizeLanguage(settings.language || i18n.resolvedLanguage || i18n.language)}
            onChange={(v) => {
              updateSetting('language', v);
              i18n.changeLanguage(v);
            }}
            options={languageOptions}
          />
        </SettingRow>
        <SettingRow
          icon={Type}
          label={t('settings.general.fontSize')}
          description={t('settings.general.fontSizeDesc')}
        >
          <SelectField
            label={t('settings.general.fontSize')}
            value={settings.fontSize}
            onChange={(v) => {
              updateSetting('fontSize', v);
              applyFontSize(v as 'small' | 'medium' | 'large' | 'xl');
            }}
            options={fontSizes}
          />
        </SettingRow>
        <SettingRow
          icon={Sparkles}
          label={t('settings.general.animations')}
          description={t('settings.general.animationsDesc')}
        >
          <Toggle
            id="animations"
            label={t('settings.general.animations')}
            checked={settings.enableAnimations}
            onChange={(v) => updateSetting('enableAnimations', v)}
          />
        </SettingRow>
        <SettingRow
          icon={CloudSun}
          label={t('settings.general.weatherSync')}
          description={t('settings.general.weatherSyncDesc')}
        >
          <Toggle
            id="weather-sync"
            label={t('settings.general.weatherSync')}
            checked={settings.weatherSync}
            onChange={(v) => updateSetting('weatherSync', v)}
          />
        </SettingRow>
        <SettingRow
          icon={CloudSun}
          label={t('settings.general.fluidGlass')}
          description={t('settings.general.fluidGlassDesc')}
        >
          <Toggle
            id="fluid-glass"
            label={t('settings.general.fluidGlass')}
            checked={settings.fluidGlass}
            onChange={(v) => updateSetting('fluidGlass', v)}
          />
        </SettingRow>
        {settings.weatherSync && (
          <SettingRow
            icon={CloudSun}
            label={t('settings.general.weatherCity')}
            description={t('settings.general.weatherCityDesc')}
          >
            {/* R5 review: input on top, live status tucked below it — the
                two no longer fight for the same horizontal line. */}
            <div className="flex flex-col items-end gap-1.5">
              <input
                type="text"
                defaultValue={settings.weatherCity}
                placeholder={t('settings.general.weatherCityPlaceholder')}
                onBlur={handleWeatherCitySave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="h-8 w-44 rounded-[2px] border border-xp-border bg-xp-popover px-2.5 text-sm text-xp-text outline-none transition-colors focus:border-primary"
                aria-label={t('settings.general.weatherCity')}
              />
              <div className="flex items-center gap-2 text-xs">
                {weatherStatus === 'saving' && (
                  <span className="text-xp-text-muted">{t('common.saving')}</span>
                )}
                {weatherStatus === 'ok' && <span className="text-xp-green">✓</span>}
                {weatherStatus === 'error' && <span className="text-xp-red">✗</span>}
                {weatherReport && (
                  <span className="text-xp-text-muted">
                    {settings.weatherCity} {Math.round(weatherReport.temperature)}°{' '}
                    {t(describeWeatherCode(weatherReport.weather_code).labelKey)} ·{' '}
                    {weatherReport.is_day
                      ? t('weather.clear') === '晴'
                        ? '白天'
                        : 'day'
                      : t('weather.clear') === '晴'
                        ? '夜间'
                        : 'night'}
                  </span>
                )}
              </div>
            </div>
          </SettingRow>
        )}
      </SettingsSection>{' '}
      <SettingsSection title={t('settings.general.layout')}>
        <SettingRow
          icon={PanelLeft}
          label={t('settings.general.sidebarWidth')}
          description={t('settings.general.sidebarWidthDesc')}
        >
          <SelectField
            label={t('settings.general.sidebarWidth')}
            value={settings.sidebarWidth}
            onChange={(v) => updateSetting('sidebarWidth', v)}
            options={sidebarWidths}
          />
        </SettingRow>
      </SettingsSection>{' '}
      <SettingsSection title={t('settings.general.system')}>
        <SettingRow
          icon={Bell}
          label={t('settings.general.notifications')}
          description={t('settings.general.notificationsDesc')}
        >
          <Toggle
            id="notifications"
            label={t('settings.general.notifications')}
            checked={settings.enableNotifications}
            onChange={(v) => updateSetting('enableNotifications', v)}
          />
        </SettingRow>
        <SettingRow
          icon={Save}
          label={t('settings.general.autoSave')}
          description={t('settings.general.autoSaveDesc')}
        >
          <Toggle
            id="autoSave"
            label={t('settings.general.autoSave')}
            checked={settings.autoSave}
            onChange={(v) => updateSetting('autoSave', v)}
          />
        </SettingRow>
      </SettingsSection>{' '}
      <SettingsSection title={t('settings.general.systemIntegration')}>
        <SystemIntegrationSettings />
      </SettingsSection>{' '}
      <SettingsSection title={t('settings.general.help')}>
        <SettingRow
          icon={HelpCircle}
          label={t('settings.general.onboardingTour')}
          description={t('settings.general.onboardingTourDesc')}
        >
          <button
            onClick={() => {
              resetTourCompleted();
              setLocation('/');
              setTimeout(() => startTour(), 300);
            }}
            className="flex items-center gap-2 rounded-[2px] bg-xp-blue px-3 py-2 text-sm font-medium text-[var(--xp-bg)] transition-opacity hover:opacity-90"
          >
            {t('settings.general.replayTour')}
          </button>
        </SettingRow>
      </SettingsSection>{' '}
      <div className="px-4 pt-4">
        <button
          onClick={() => setSettings(DEFAULT_SETTINGS)}
          className="flex items-center gap-2 rounded-[2px] px-3 py-2 text-sm text-xp-red transition-colors hover:bg-xp-red/10"
        >
          <RotateCcw size={14} />
          {t('settings.resetAll')}
        </button>
      </div>
    </div>
  );
};

export default GeneralSettings;
