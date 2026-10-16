import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import zh from './locales/zh.json';
import { STORAGE_KEYS } from './lib/storage-keys';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, normalizeLanguage } from './lib/language-settings';

const SETTINGS_KEY = STORAGE_KEYS.SETTINGS;

const wispSettingsDetector = {
  name: 'wispSettings',
  lookup(): string | undefined {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.language) return normalizeLanguage(parsed.language);
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_LANGUAGE;
  },
  cacheUserLanguage(lng: string): void {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      const settings = saved ? JSON.parse(saved) : {};
      settings.language = normalizeLanguage(lng);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  },
};

const languageDetector = new LanguageDetector();
languageDetector.addDetector(wispSettingsDetector);

const syncDocumentLanguage = (language: string) => {
  document.documentElement.lang = normalizeLanguage(language);
};
i18n.on('languageChanged', syncDocumentLanguage);

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    load: 'languageOnly',
    detection: {
      order: ['wispSettings', 'navigator'],
      caches: ['wispSettings'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

syncDocumentLanguage(i18n.resolvedLanguage || DEFAULT_LANGUAGE);

export default i18n;
