import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import zh from './locales/zh.json';
import { STORAGE_KEYS } from './lib/storage-keys';

const SETTINGS_KEY = STORAGE_KEYS.SETTINGS;

const wispSettingsDetector = {
  name: 'wispSettings',
  lookup(): string | undefined {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.language) return parsed.language;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  },
  cacheUserLanguage(lng: string): void {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      const settings = saved ? JSON.parse(saved) : {};
      settings.language = lng;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  },
};

const languageDetector = new LanguageDetector();
languageDetector.addDetector(wispSettingsDetector);

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh'],
    nonExplicitSupportedLngs: false,
    detection: {
      order: ['wispSettings', 'navigator'],
      caches: ['wispSettings'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
