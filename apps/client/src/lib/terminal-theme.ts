import type { ITheme } from '@xterm/xterm';

/** Opaque terminal surfaces keep ANSI text readable over native window materials. */
export const TERMINAL_THEMES = {
  light: {
    background: '#f7f7f9',
    foreground: '#25262b',
    cursor: '#005fc4',
    cursorAccent: '#f7f7f9',
    selectionBackground: '#cddff8',
    selectionInactiveBackground: '#dce2ec',
    selectionForeground: '#25262b',
    black: '#25262b',
    red: '#b42332',
    green: '#216b39',
    yellow: '#856300',
    blue: '#245fc4',
    magenta: '#9041a8',
    cyan: '#006b7a',
    white: '#626878',
    brightBlack: '#626878',
    brightRed: '#c03432',
    brightGreen: '#25713e',
    brightYellow: '#886600',
    brightBlue: '#2666c7',
    brightMagenta: '#9850ab',
    brightCyan: '#087482',
    brightWhite: '#353a46',
  },
  dark: {
    background: '#202127',
    foreground: '#ececf0',
    cursor: '#8bbbff',
    cursorAccent: '#202127',
    selectionBackground: '#344d70',
    selectionInactiveBackground: '#394252',
    selectionForeground: '#f7f8fa',
    black: '#1b1d23',
    red: '#ff8c8c',
    green: '#93d9a3',
    yellow: '#e3c583',
    blue: '#91baff',
    magenta: '#d8a3ef',
    cyan: '#83d2d9',
    white: '#c1c6d1',
    brightBlack: '#9299a8',
    brightRed: '#ffa4a4',
    brightGreen: '#b0e9be',
    brightYellow: '#f2d793',
    brightBlue: '#afd0ff',
    brightMagenta: '#e8bdf6',
    brightCyan: '#a0e4e9',
    brightWhite: '#ffffff',
  },
} satisfies Record<'light' | 'dark', ITheme>;

/** Use the resolved app appearance, including system changes applied by the theme manager. */
export const getTerminalTheme = (
  root: HTMLElement | undefined = typeof document === 'undefined'
    ? undefined
    : document.documentElement,
) => (root?.classList.contains('theme-rolex') ? TERMINAL_THEMES.dark : TERMINAL_THEMES.light);
