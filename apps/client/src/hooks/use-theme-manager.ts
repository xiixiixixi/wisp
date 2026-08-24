import { useState, useEffect, useCallback } from 'react';
import { applyTheme } from '@/lib/utils';
import { useAllThemes } from '@/lib/theme-registry';
import { resolveTheme } from '@/lib/ui-state';

// ── Hook ─────────────────────────────────────────────────────────────────────

export const useThemeManager = () => {
  const themes = useAllThemes();
  const [theme, setTheme] = useState(() => resolveTheme());

  // Apply theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleApplyTheme = useCallback((themeKey: string) => {
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
