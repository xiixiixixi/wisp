import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ITheme } from '@xterm/xterm';
import { getTerminalTheme, TERMINAL_THEMES } from '@/lib/terminal-theme';

type Rgb = [number, number, number];

function opaqueRgb(color: string | undefined): Rgb {
  expect(color, 'A terminal color must be explicitly defined').toBeTruthy();
  const sample = document.createElement('span');
  sample.style.color = color ?? '';
  expect(sample.style.color, `Invalid CSS color: ${color}`).not.toBe('');
  document.body.append(sample);
  const computed = getComputedStyle(sample).color;
  sample.remove();

  const match = computed.match(/^rgba?\(([^)]+)\)$/);
  expect(match, `Expected a concrete RGB color: ${color}`).not.toBeNull();
  const [red, green, blue, alpha = 1] = match![1].split(/[,\s/]+/).map(Number);
  expect(alpha, `${color} must be opaque`).toBe(1);
  return [red, green, blue];
}

// WCAG relative luminance, calculated independently of the production palette.
function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string | undefined, background: string | undefined): number {
  const first = luminance(opaqueRgb(foreground));
  const second = luminance(opaqueRgb(background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const ansiColors = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
] as const;

describe.each(['light', 'dark'] as const)('%s terminal palette', (appearance) => {
  const theme: ITheme = TERMINAL_THEMES[appearance];

  it('provides an opaque canvas with at least 7:1 main text contrast', () => {
    expect(contrast(theme.foreground, theme.background)).toBeGreaterThanOrEqual(7);
  });

  it('keeps text under the block cursor readable', () => {
    expect(contrast(theme.cursorAccent, theme.cursor)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps selected text readable', () => {
    expect(contrast(theme.selectionForeground, theme.selectionBackground)).toBeGreaterThanOrEqual(
      4.5,
    );
    if (theme.selectionInactiveBackground) {
      expect(
        contrast(theme.selectionForeground, theme.selectionInactiveBackground),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(ansiColors)('keeps %s ANSI output at least 4.5:1 against the canvas', (color) => {
    expect(contrast(theme[color], theme.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('terminal appearance selection', () => {
  const originalClassName = document.documentElement.className;
  const originalAppearance = document.documentElement.dataset.wispAppearance;

  afterEach(() => {
    document.documentElement.className = originalClassName;
    if (originalAppearance === undefined) delete document.documentElement.dataset.wispAppearance;
    else document.documentElement.dataset.wispAppearance = originalAppearance;
    vi.restoreAllMocks();
  });

  it.each([
    { className: '', expected: 'light' },
    { className: 'theme-fluid', expected: 'light' },
    { className: 'theme-light', expected: 'light' },
    { className: 'theme-light theme-fluid', expected: 'light' },
    { className: 'theme-rolex', expected: 'dark' },
    { className: 'theme-rolex theme-fluid', expected: 'dark' },
  ] as const)('selects $expected for "$className"', ({ className, expected }) => {
    const root = document.createElement('html');
    root.className = className;
    expect(getTerminalTheme(root)).toEqual(TERMINAL_THEMES[expected]);
  });

  it('reads the current document root when no root is supplied', () => {
    document.documentElement.className = 'theme-light theme-fluid';
    expect(getTerminalTheme()).toEqual(TERMINAL_THEMES.light);
    document.documentElement.className = 'theme-rolex theme-fluid';
    expect(getTerminalTheme()).toEqual(TERMINAL_THEMES.dark);
  });

  it('does not let a dark system preference override explicit light appearance', () => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    vi.spyOn(window, 'matchMedia').mockReturnValue({ ...mediaQuery, matches: true });
    document.documentElement.className = 'theme-light theme-fluid';
    document.documentElement.dataset.wispAppearance = 'light';

    expect(getTerminalTheme()).toEqual(TERMINAL_THEMES.light);
  });
});
