import { themes as builtinThemes, type ThemeDef } from './utils';

/**
 * Wisp supports light, dark, and system appearance via the appearance module.
 * This module keeps the historical hook shape so existing callers keep working.
 */
export const getAllThemes = (): Record<string, ThemeDef> => builtinThemes;

// ── React hook ────────────────────────────────────────────────────

export const useAllThemes = (): Record<string, ThemeDef> => builtinThemes;
