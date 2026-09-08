import { useEffect } from 'react';
import { migrateRetiredSettings } from '@/lib/retired-settings';

/** Fixed appearance. OS motion, contrast and transparency preferences are
 * handled by CSS media queries, without app-specific controls or overrides. */
const SkySync = () => {
  useEffect(() => {
    const applyDefaults = () => {
      migrateRetiredSettings();
      const root = document.documentElement;
      root.classList.remove(
        'theme-rolex',
        'theme-glass',
        'font-small',
        'font-medium',
        'font-large',
        'font-xl',
        'reduce-motion',
        'reduce-transparency',
        'enhanced-focus',
        'high-contrast',
      );
      root.classList.add('theme-light', 'theme-fluid');
      delete root.dataset.sky;
    };
    applyDefaults();
    window.addEventListener('wisp-settings-changed', applyDefaults);
    return () => window.removeEventListener('wisp-settings-changed', applyDefaults);
  }, []);
  return null;
};
export default SkySync;
