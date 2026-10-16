import type { Terminal } from '@xterm/xterm';
import type { PromptJumpDirection } from './terminal-shell-integration';
import { isMacPlatform } from './shortcut-utils';
import { isTauri, transport } from './transport';

export const TERMINAL_FONT_SIZE = 14;

/** Search-bar controls wired by the terminal panel: ⌘F/⌘E open, ⌘G cycles. */
export interface TerminalSearchControls {
  /** Open the find bar; `seedSelection` fills it with the current selection. */
  open: (seedSelection: boolean) => void;
  next: () => void;
  previous: () => void;
}

/** Prompt-mark navigation wired by the panel: ⌘↑/⌘↓ (shell integration). */
export type TerminalPromptJump = (direction: PromptJumpDirection) => boolean;

/** Shell control keys must never be interpreted as file-manager shortcuts. */
export const terminalOwnsKey = (event: KeyboardEvent): boolean => {
  if (event.ctrlKey && !event.metaKey) return true;
  if (event.altKey && !event.metaKey) return true;
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    ['c', 'v', 'a', 'k', 'f', 'e', 'g', '=', '+', '-', '0', 'arrowup', 'arrowdown'].includes(
      event.key.toLowerCase(),
    )
  );
};

/** Ghostty's `clipboard-trim-trailing-spaces`: strip trailing whitespace on
 *  every line plus the final newline block xterm pads selections with. */
export const trimCopiedTerminalText = (text: string): string =>
  text
    .replace(/[ \t]+(?=\r?\n)/g, '')
    .replace(/[ \t]+$/, '')
    .replace(/(?:\r?\n)+$/, '');

type ClipboardTerminal = Pick<Terminal, 'getSelection' | 'focus' | 'paste'>;

/** Native paste produces xterm's paste event, preserving bracketed paste and IME. */
export const editTerminalClipboard = async (
  terminal: ClipboardTerminal,
  action: 'copy' | 'paste',
): Promise<void> => {
  if (action === 'copy' && !terminal.getSelection()) return;
  terminal.focus();
  if (isTauri() && isMacPlatform()) {
    // Wisp's app menu deliberately does not claim macOS edit accelerators.
    // Forward explicitly, just as native text fields do. xterm handles the
    // resulting clipboard event rather than copying its hidden textarea.
    // The macOS payload is trimmed by the panel's `copy` listener.
    await transport('perform_native_edit_action', { action });
    return;
  }
  if (action === 'copy') {
    await navigator.clipboard.writeText(trimCopiedTerminalText(terminal.getSelection()));
  } else {
    // paste(), unlike a raw PTY write, wraps multiline text when the shell
    // enables bracketed paste and leaves command execution to the user.
    terminal.paste(await navigator.clipboard.readText());
  }
};

export const createTerminalKeyHandler =
  (
    terminal: Terminal,
    onClipboardError: (action: 'copy' | 'paste', error: unknown) => void,
    onFontSizeChange: (size: number) => void,
    onSearch?: TerminalSearchControls,
    onPromptJump?: TerminalPromptJump,
  ) =>
  (event: KeyboardEvent): boolean => {
    if (event.type !== 'keydown' || event.isComposing) return true;
    const key = event.key.toLowerCase();
    const mac = isMacPlatform();
    const primary = mac
      ? event.metaKey && !event.ctrlKey && !event.altKey
      : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
    if (!primary) return true;

    if ((key === 'c' || key === 'v') && (!mac || !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      const action = key === 'c' ? 'copy' : 'paste';
      void editTerminalClipboard(terminal, action).catch((error) =>
        onClipboardError(action, error),
      );
      return false;
    }
    if (key === 'a' && !event.shiftKey) {
      event.preventDefault();
      terminal.selectAll();
      return false;
    }
    if (key === 'k' && !event.shiftKey) {
      event.preventDefault();
      terminal.clear();
      return false;
    }
    if (onSearch && (key === 'f' || key === 'e')) {
      event.preventDefault();
      onSearch.open(key === 'e');
      return false;
    }
    if (onSearch && key === 'g') {
      event.preventDefault();
      // On Windows/Linux the primary modifier already includes Shift, so
      // ⇧+primary stays "next"; the bar's buttons and Shift+Enter go back.
      if (event.shiftKey && mac) {
        onSearch.previous();
      } else {
        onSearch.next();
      }
      return false;
    }
    if (onPromptJump && (key === 'arrowup' || key === 'arrowdown')) {
      // Prompt-mark jump (⌘↑/⌘↓). Always consumed so the modified arrow
      // neither reaches the shell nor app shortcuts; without recorded marks
      // the jump itself is a silent no-op.
      event.preventDefault();
      onPromptJump(key === 'arrowup' ? 'previous' : 'next');
      return false;
    }
    if (['=', '+', '-', '0'].includes(key)) {
      event.preventDefault();
      const size = terminal.options.fontSize ?? TERMINAL_FONT_SIZE;
      const next =
        key === '0'
          ? TERMINAL_FONT_SIZE
          : Math.max(10, Math.min(28, size + (key === '-' ? -1 : 1)));
      terminal.options.fontSize = next;
      onFontSizeChange(next);
      return false;
    }
    return true;
  };
