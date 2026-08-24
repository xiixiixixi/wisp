import { themes as builtinThemes, type ThemeDef } from './utils';

/**
 * Wisp ships exactly three built-in themes (Wisp Ink, Wisp Slate, Wisp Paper).
 * This module keeps the historical hook shape so existing callers keep working.
 */
export const getAllThemes = (): Record<string, ThemeDef> => builtinThemes;

// ── React hook ────────────────────────────────────────────────────

export const useAllThemes = (): Record<string, ThemeDef> => builtinThemes;
