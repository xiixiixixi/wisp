import { useState, useEffect, useCallback } from 'react';
import { applyTheme } from '@/lib/utils';
import { useAllThemes, installThemeEventBridge } from '@/lib/theme-registry';
import { resolveTheme, markThemeChosen } from '@/lib/ui-state';

// Install the event bridge once (listens for extension theme register/unregister)
installThemeEventBridge();

// ── Hook ─────────────────────────────────────────────────────────────────────

export const useThemeManager = () => {
  const themes = useAllThemes();
  const [theme, setTheme] = useState(() => resolveTheme());

  // Apply theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleApplyTheme = useCallback((themeKey: string) => {
    markThemeChosen();
    setTheme(themeKey);
    applyTheme(themeKey);
  }, []);

  return {
    themes,
    theme,
    setTheme,
    handleApplyTheme,
  };
};
