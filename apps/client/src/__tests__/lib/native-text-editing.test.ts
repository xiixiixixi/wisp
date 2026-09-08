import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNativeTextEditing } from '@/lib/native-text-editing';
import { isTextEditingTarget } from '@/lib/text-editing';
import { isMacPlatform } from '@/lib/shortcut-utils';
import { isTauri, transport } from '@/lib/transport';

vi.mock('@/lib/transport', () => ({
  isTauri: vi.fn(() => true),
  transport: vi.fn(async () => undefined),
}));
vi.mock('@/lib/shortcut-utils', () => ({ isMacPlatform: vi.fn(() => true) }));

let dispose = () => {};
const press = (target: HTMLElement, key: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    metaKey: true,
    key,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(isMacPlatform).mockReturnValue(true);
  vi.mocked(transport).mockClear();
  dispose = installNativeTextEditing();
});
afterEach(() => {
  dispose();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe('macOS native text editing', () => {
  it.each([
    ['c', false, 'copy'],
    ['x', false, 'cut'],
    ['v', false, 'paste'],
    ['a', false, 'select_all'],
    ['z', false, 'undo'],
    ['z', true, 'redo'],
  ])('forwards Cmd%s (shift=%s) to %s in inputs', (key, shiftKey, action) => {
    const input = document.createElement('input');
    input.value = '/Users/example/Documents/文档.txt';
    document.body.append(input);
    input.focus();
    input.select();
    expect(press(input, key, { shiftKey }).defaultPrevented).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith('perform_native_edit_action', { action });
    expect(input.value).toBe('/Users/example/Documents/文档.txt');
  });

  it.each(['textarea', 'readonly', 'contenteditable', 'plaintext-only'])(
    'supports %s editors',
    (type) => {
      let tagName = 'div';
      if (type === 'textarea') tagName = 'textarea';
      if (type === 'readonly') tagName = 'input';
      const element = document.createElement(tagName);
      if (element instanceof HTMLInputElement) element.readOnly = true;
      if (type === 'contenteditable' || type === 'plaintext-only') {
        element.setAttribute('contenteditable', type === 'plaintext-only' ? type : 'true');
      }
      document.body.append(element);
      press(element, 'c');
      expect(transport).toHaveBeenCalledOnce();
      expect(transport).toHaveBeenCalledWith('perform_native_edit_action', {
        action: 'copy',
      });
    },
  );

  it('copies selected preview text but leaves file rows alone', () => {
    const preview = document.createElement('p');
    preview.textContent = 'Selected document text';
    document.body.append(preview);
    expect(press(preview, 'c').defaultPrevented).toBe(false);
    const range = document.createRange();
    range.selectNodeContents(preview);
    window.getSelection()?.addRange(range);
    expect(press(preview, 'c').defaultPrevented).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith('perform_native_edit_action', {
      action: 'copy',
    });
    expect(press(preview, 'x').defaultPrevented).toBe(false);
  });

  it('respects an editor-owned undo, IME and other modifier combinations', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'z') event.preventDefault();
    });
    press(input, 'z');
    press(input, 'c', { isComposing: true });
    press(input, 'c', { altKey: true });
    press(input, 'c', { shiftKey: true });
    press(input, 'c', { metaKey: false, ctrlKey: true });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not intercept xterm or native non-text controls', () => {
    const terminal = document.createElement('div');
    terminal.className = 'xterm';
    const textarea = document.createElement('textarea');
    terminal.append(textarea);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(terminal, checkbox);
    expect(press(textarea, 'c').defaultPrevented).toBe(false);
    expect(press(checkbox, 'a').defaultPrevented).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['browser', 'windows'])('keeps native editing defaults in %s mode', (mode) => {
    dispose();
    if (mode === 'browser') vi.mocked(isTauri).mockReturnValue(false);
    else vi.mocked(isMacPlatform).mockReturnValue(false);
    dispose = installNativeTextEditing();
    const input = document.createElement('input');
    document.body.append(input);
    expect(press(input, 'c').defaultPrevented).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it('unregisters its listener on cleanup', () => {
    dispose();
    const input = document.createElement('input');
    document.body.append(input);
    press(input, 'c');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('text editing ownership', () => {
  it('recognizes nested editors and respects noneditable islands', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('contenteditable', 'true');
    const text = document.createElement('span');
    const island = document.createElement('span');
    island.setAttribute('contenteditable', 'false');
    const child = document.createElement('span');
    island.append(child);
    editor.append(text, island);
    expect(isTextEditingTarget(text)).toBe(true);
    expect(isTextEditingTarget(child)).toBe(false);
    expect(isTextEditingTarget(null)).toBe(false);
  });
});
