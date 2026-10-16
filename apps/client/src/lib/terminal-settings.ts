import { STORAGE_KEYS } from '@/lib/storage-keys';
import { TERMINAL_FONT_SIZE } from '@/lib/terminal-input';
import { isMacPlatform } from '@/lib/shortcut-utils';

/** Terminal preferences share the `wisp:settings` object so they survive
 *  restarts and round-trip with the settings dialog. The panel re-reads them
 *  on every `wisp-settings-changed` broadcast — writers below dispatch it so
 *  an open dialog, ⌘± shortcuts and live terminals stay in sync. */

/** CJK-capable fallbacks keep Chinese/Japanese glyphs on a monospace metric
 *  instead of a proportional system fallback (#3 — Wisp's own highlight). */
export const TERMINAL_FONT_FALLBACKS =
  '"SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", monospace';

/** A custom family replaces the head of the stack, never the CJK tail. */
export const buildTerminalFontStack = (custom: string): string => {
  const family = custom.replace(/"/g, '').trim();
  return family ? `"${family}", ${TERMINAL_FONT_FALLBACKS}` : TERMINAL_FONT_FALLBACKS;
};

/** Link-click modifiers (#42): ⌘ on macOS maps to Ctrl elsewhere. */
export type TerminalLinkModifier = 'super' | 'alt' | 'ctrl';

export const LINK_MODIFIERS: readonly TerminalLinkModifier[] = ['super', 'alt', 'ctrl'];

/** Does a mouse event satisfy the configured link modifier? */
export const linkModifierMatches = (
  event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  modifier: TerminalLinkModifier,
): boolean => {
  switch (modifier) {
    case 'alt':
      return event.altKey;
    case 'ctrl':
      return event.ctrlKey;
    case 'super':
      return isMacPlatform() ? event.metaKey : event.ctrlKey;
  }
};

export const MIN_TERMINAL_SCROLLBACK = 1000;
export const MAX_TERMINAL_SCROLLBACK = 100000;
export const DEFAULT_TERMINAL_SCROLLBACK = 10000;

export const MIN_COMMAND_NOTIFY_SECONDS = 1;
export const MAX_COMMAND_NOTIFY_SECONDS = 3600;
export const DEFAULT_COMMAND_NOTIFY_SECONDS = 10;

export interface TerminalEnvVar {
  key: string;
  value: string;
}

export const MAX_TERMINAL_ENV_VARS = 20;

/** Keep only entries a shell could actually consume; first 20 win (#45). */
export const sanitizeTerminalEnvVars = (entries: unknown): TerminalEnvVar[] => {
  if (!Array.isArray(entries)) return [];
  const usable: TerminalEnvVar[] = [];
  for (const entry of entries) {
    if (usable.length >= MAX_TERMINAL_ENV_VARS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, value } = entry as { key?: unknown; value?: unknown };
    if (typeof key !== 'string' || typeof value !== 'string') continue;
    const name = key.trim();
    if (!name || name.includes('=') || name.includes('\0')) continue;
    if (usable.some((existing) => existing.key === name)) continue;
    usable.push({ key: name, value });
  }
  return usable;
};

const readSettings = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const writeSettings = (settings: Record<string, unknown>): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    // Same broadcast the settings dialog uses, so an open dialog and every
    // live terminal pick the change up immediately.
    window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
  } catch {
    /* storage unavailable */
  }
};

/** Font size chosen with ⌘+/⌘-/⌘0 or the settings page, clamped to the same
 *  10–28 range the shortcuts enforce. Falls back to the built-in default. */
export const readTerminalFontSize = (): number => {
  const value = readSettings().terminalFontSize;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(10, Math.min(28, Math.round(value)))
    : TERMINAL_FONT_SIZE;
};

export const writeTerminalFontSize = (size: number): void => {
  const clamped = Math.max(10, Math.min(28, Math.round(size)));
  writeSettings({ ...readSettings(), terminalFontSize: clamped });
};

/** Custom font family head; empty = the built-in monospace stack. */
export const readTerminalFontFamily = (): string => {
  const value = readSettings().terminalFontFamily;
  return typeof value === 'string' ? value : '';
};

export const writeTerminalFontFamily = (family: string): void => {
  writeSettings({ ...readSettings(), terminalFontFamily: family });
};

/** Scrollback lines for NEW sessions; existing tabs keep their buffer. */
export const readTerminalScrollback = (): number => {
  const value = readSettings().terminalScrollback;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(
        MIN_TERMINAL_SCROLLBACK,
        Math.min(MAX_TERMINAL_SCROLLBACK, Math.round(value)),
      )
    : DEFAULT_TERMINAL_SCROLLBACK;
};

export const writeTerminalScrollback = (lines: number): void => {
  const clamped = Math.max(
    MIN_TERMINAL_SCROLLBACK,
    Math.min(MAX_TERMINAL_SCROLLBACK, Math.round(lines)),
  );
  writeSettings({ ...readSettings(), terminalScrollback: clamped });
};

/** Custom shell path; empty = auto ($SHELL, resolved by the Rust spawn). */
export const readTerminalShell = (): string => {
  const value = readSettings().terminalShell;
  return typeof value === 'string' ? value.trim() : '';
};

export const writeTerminalShell = (shell: string): void => {
  writeSettings({ ...readSettings(), terminalShell: shell.trim() });
};

/** Copy-on-select (Ghostty's `copy-on-select`), on by default. */
export const readTerminalCopyOnSelect = (): boolean => {
  const value = readSettings().terminalCopyOnSelect;
  return typeof value === 'boolean' ? value : true;
};

export const writeTerminalCopyOnSelect = (enabled: boolean): void => {
  writeSettings({ ...readSettings(), terminalCopyOnSelect: enabled });
};

/** Ligatures (#4 verdict): off by default — CJK output can misrender. */
export const readTerminalLigatures = (): boolean => {
  const value = readSettings().terminalLigatures;
  return typeof value === 'boolean' ? value : false;
};

export const writeTerminalLigatures = (enabled: boolean): void => {
  writeSettings({ ...readSettings(), terminalLigatures: enabled });
};

export const readTerminalLinkModifier = (): TerminalLinkModifier => {
  const value = readSettings().terminalLinkModifier;
  return LINK_MODIFIERS.includes(value as TerminalLinkModifier)
    ? (value as TerminalLinkModifier)
    : 'super';
};

export const writeTerminalLinkModifier = (modifier: TerminalLinkModifier): void => {
  writeSettings({ ...readSettings(), terminalLinkModifier: modifier });
};

/** Bell alerts (#30, T1): off by default — the panel stays silent until the
 *  user opts into the 🔔 tab badge. */
export const readTerminalBellEnabled = (): boolean => {
  const value = readSettings().terminalBell;
  return typeof value === 'boolean' ? value : false;
};

export const writeTerminalBellEnabled = (enabled: boolean): void => {
  writeSettings({ ...readSettings(), terminalBell: enabled });
};

/** Command-completion badge threshold (#22), in seconds. */
export const readTerminalCommandNotifySeconds = (): number => {
  const value = readSettings().terminalCommandNotifySeconds;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(
        MIN_COMMAND_NOTIFY_SECONDS,
        Math.min(MAX_COMMAND_NOTIFY_SECONDS, Math.round(value)),
      )
    : DEFAULT_COMMAND_NOTIFY_SECONDS;
};

export const writeTerminalCommandNotifySeconds = (seconds: number): void => {
  const clamped = Math.max(
    MIN_COMMAND_NOTIFY_SECONDS,
    Math.min(MAX_COMMAND_NOTIFY_SECONDS, Math.round(seconds)),
  );
  writeSettings({ ...readSettings(), terminalCommandNotifySeconds: clamped });
};

/** New user-created sessions start read-only (#28 default), off by default. */
export const readTerminalReadonlyByDefault = (): boolean => {
  const value = readSettings().terminalReadonlyByDefault;
  return typeof value === 'boolean' ? value : false;
};

export const writeTerminalReadonlyByDefault = (enabled: boolean): void => {
  writeSettings({ ...readSettings(), terminalReadonlyByDefault: enabled });
};

export const readTerminalEnvVars = (): TerminalEnvVar[] =>
  sanitizeTerminalEnvVars(readSettings().terminalEnvVars);

export const writeTerminalEnvVars = (entries: TerminalEnvVar[]): void => {
  writeSettings({ ...readSettings(), terminalEnvVars: sanitizeTerminalEnvVars(entries) });
};
