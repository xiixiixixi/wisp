import i18n from '@/i18n';
import { normalizeLanguage } from './language-settings';
import { isMacPlatform } from './shortcut-utils';
import { isTauri, transport } from './transport';

export const installNativeMenuLanguage = (): (() => void) => {
  if (!isTauri() || !isMacPlatform()) return () => {};
  const sync = () => {
    void transport('set_app_menu_language', {
      language: normalizeLanguage(i18n.resolvedLanguage || i18n.language),
    }).catch((error) => console.warn('Could not update the app menu language:', error));
  };
  sync();
  i18n.on('languageChanged', sync);
  return () => {
    i18n.off('languageChanged', sync);
  };
};
