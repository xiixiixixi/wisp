import { isMacPlatform } from './shortcut-utils';
import { isTauri, transport } from './transport';
import { hasSelectedText, isTextEditingTarget } from './text-editing';

const EDIT_ACTIONS: Record<string, string> = {
  c: 'copy',
  x: 'cut',
  v: 'paste',
  a: 'select_all',
  z: 'undo',
};

/**
 * Wisp leaves macOS edit accelerators unclaimed so file shortcuts reach JS.
 * WKWebView then needs an explicit native responder action for text editing.
 * Listen in bubble phase: CodeMirror and other editors get first refusal,
 * preserving their own keymaps and undo history. Browsers/Windows keep their
 * normal editing defaults. No clipboard contents cross the IPC boundary.
 */
export const installNativeTextEditing = (): (() => void) => {
  if (!isTauri() || !isMacPlatform()) return () => {};

  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      !event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('.xterm')) return;

    const key = event.key.toLowerCase();
    if (event.shiftKey && key !== 'z') return;
    const action = event.shiftKey ? 'redo' : EDIT_ACTIONS[key];
    if (!action) return;
    if (!isTextEditingTarget(target) && !(action === 'copy' && hasSelectedText())) return;

    event.preventDefault();
    event.stopPropagation();
    void transport('perform_native_edit_action', { action }).catch((error) => {
      console.error(`Native text ${action} failed:`, error);
    });
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
};
