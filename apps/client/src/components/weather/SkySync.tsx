import { useEffect } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * 天气只以芯片与主页卡片呈现。SkySync 现在只做类同步：亮纸主题恒定
 * （墨色极性已删）+ 流体玻璃/无障碍开关跟随设置。
 */
const syncAccessibilityClasses = () => {
  const root = document.documentElement;
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}') as {
      reducedMotion?: boolean;
      reduceTransparency?: boolean;
      enhancedFocus?: boolean;
      highContrast?: boolean;
      fluidGlass?: boolean;
    };
    root.classList.toggle('reduce-motion', settings.reducedMotion === true);
    root.classList.toggle('reduce-transparency', settings.reduceTransparency === true);
    root.classList.toggle('enhanced-focus', settings.enhancedFocus === true);
    root.classList.toggle('high-contrast', settings.highContrast === true);
    root.classList.toggle('theme-fluid', settings.fluidGlass !== false);
  } catch {
    root.classList.remove(
      'reduce-motion',
      'reduce-transparency',
      'enhanced-focus',
      'high-contrast',
    );
  }
};

const SkySync = () => {
  // The accessibility & fluid-glass classes live in settings (another route)
  // — follow them live.
  useEffect(() => {
    syncAccessibilityClasses();
    window.addEventListener('wisp-settings-changed', syncAccessibilityClasses);
    return () => window.removeEventListener('wisp-settings-changed', syncAccessibilityClasses);
  }, []);

  // 2026-09-06 用户决定：删除墨色极性 — 全天候亮纸，不再跟随日落翻转。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-rolex', 'theme-glass');
    root.classList.add('theme-light');
    delete root.dataset.sky;
  }, []);

  return null;
};

export default SkySync;
