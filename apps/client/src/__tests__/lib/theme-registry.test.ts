import { describe, it, expect, vi } from 'vitest';
import { getAllThemes, useAllThemes } from '@/lib/theme-registry';
import { renderHook } from '@testing-library/react';

// Mock the utils module that provides built-in themes
vi.mock('@/lib/utils', () => ({
  themes: {
    rolex: {
      name: 'Wisp Ink',
      primary: '#79a8d8',
      bg: '#11161d',
      surface: '#171d25',
      text: '#e6ebf1',
    },
    glass: {
      name: 'Wisp Slate',
      primary: '#8aa8c8',
      bg: '#242a32',
      surface: '#2b323b',
      text: '#edf0f3',
    },
    light: {
      name: 'Wisp Paper',
      primary: '#4f759b',
      bg: '#f1f3f5',
      surface: '#e8ecf0',
      text: '#26313b',
    },
  },
}));

describe('theme-registry', () => {
  describe('getAllThemes', () => {
    it('returns exactly the three built-in themes', () => {
      const themes = getAllThemes();
      expect(Object.keys(themes).sort()).toEqual(['glass', 'light', 'rolex']);
    });

    it('includes Wisp Ink, Wisp Slate, and Wisp Paper', () => {
      const themes = getAllThemes();
      expect(themes.rolex.name).toBe('Wisp Ink');
      expect(themes.glass.name).toBe('Wisp Slate');
      expect(themes.light.name).toBe('Wisp Paper');
    });
  });

  describe('useAllThemes', () => {
    it('exposes the built-in themes to components', () => {
      const { result } = renderHook(() => useAllThemes());
      expect(Object.keys(result.current).sort()).toEqual(['glass', 'light', 'rolex']);
    });
  });
});
