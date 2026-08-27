/**
 * Default shortcut bindings for the browser demo.
 *
 * Mirrors `default_settings()` in apps/src-tauri/src/shortcuts/manager.rs —
 * the demo has no Rust backend, so `getShortcuts` fails and we fall back to
 * this table to keep keyboard shortcuts usable at http://…?demo=1.
 * Keep in sync when the Rust defaults change.
 */
import type { ShortcutBinding } from '@/lib/tauri-api';

const B = (
  id: string,
  keys: string[],
  action: ShortcutBinding['action'],
  description: string,
  keyCombination: string,
): ShortcutBinding => ({
  id,
  keys,
  action,
  context: 'file-explorer',
  enabled: true,
  profile: 'default',
  description,
  global: false,
  key_combination: keyCombination,
});

export const DEMO_DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  // ── File Operations (Finder-aligned) ──
  B('copy', ['ctrl', 'c'], 'Copy', 'Copy selected items', 'ctrl+c'),
  B('cut', ['ctrl', 'x'], 'Cut', 'Cut selected items', 'ctrl+x'),
  B('paste', ['ctrl', 'v'], 'Paste', 'Paste items', 'ctrl+v'),
  B(
    'paste-move',
    ['ctrl', 'alt', 'v'],
    'PasteMove',
    'Move clipboard items here (Finder ⌥⌘V)',
    'ctrl+alt+v',
  ),
  B('delete', ['ctrl', 'backspace'], 'Delete', 'Move to trash', 'ctrl+backspace'),
  B('rename', ['enter'], 'Rename', 'Rename selected item', 'enter'),
  B('rename-f2', ['f2'], 'Rename', 'Rename selected item (F2 habit key)', 'f2'),
  B('new-folder', ['ctrl', 'shift', 'n'], 'NewFolder', 'Create new folder', 'ctrl+shift+n'),
  B('new-file', ['ctrl', 'alt', 'n'], 'NewFile', 'Create new file', 'ctrl+alt+n'),
  B('duplicate', ['ctrl', 'd'], 'Duplicate', 'Duplicate selected files', 'ctrl+d'),
  B('copy-path', ['ctrl', 'alt', 'c'], 'CopyPath', 'Copy path of selected item', 'ctrl+alt+c'),
  B('quick-look', ['space'], 'QuickLook', 'Quick Look selected item', 'space'),
  B('quick-look-y', ['ctrl', 'y'], 'QuickLook', 'Quick Look selected item', 'ctrl+y'),
  B('open-selected', ['ctrl', 'o'], 'Open', 'Open selected item', 'ctrl+o'),
  B('open-selected-down', ['ctrl', 'down'], 'Open', 'Open selected item', 'ctrl+down'),
  B('properties', ['ctrl', 'i'], 'Properties', 'Show properties of selected item', 'ctrl+i'),
  // ── History ──
  B('undo', ['ctrl', 'z'], 'Undo', 'Undo last operation', 'ctrl+z'),
  B('redo', ['ctrl', 'shift', 'z'], 'Redo', 'Redo undone operation', 'ctrl+shift+z'),
  // ── Navigation ──
  B('navigate-back', ['ctrl', '['], 'NavigateBack', 'Go back', 'ctrl+['),
  B('navigate-forward', ['ctrl', ']'], 'NavigateForward', 'Go forward', 'ctrl+]'),
  B('navigate-up', ['ctrl', 'up'], 'NavigateUp', 'Go to parent directory', 'ctrl+up'),
  B('go-home', ['ctrl', 'shift', 'h'], 'GoHome', 'Go to home directory', 'ctrl+shift+h'),
  B(
    'go-to-path',
    ['ctrl', 'shift', 'g'],
    'GoToPath',
    'Go to folder (focus address bar)',
    'ctrl+shift+g',
  ),
  B(
    'go-desktop',
    ['ctrl', 'shift', 'd'],
    { GoToSpecial: { folder: 'desktop' } },
    'Go to Desktop',
    'ctrl+shift+d',
  ),
  B(
    'go-downloads',
    ['ctrl', 'alt', 'l'],
    { GoToSpecial: { folder: 'downloads' } },
    'Go to Downloads',
    'ctrl+alt+l',
  ),
  B(
    'go-documents',
    ['ctrl', 'shift', 'o'],
    { GoToSpecial: { folder: 'documents' } },
    'Go to Documents',
    'ctrl+shift+o',
  ),
  B(
    'go-applications',
    ['ctrl', 'shift', 'a'],
    { GoToSpecial: { folder: 'applications' } },
    'Go to Applications',
    'ctrl+shift+a',
  ),
  // ── Selection ──
  B('select-all', ['ctrl', 'a'], 'SelectAll', 'Select all files', 'ctrl+a'),
  B(
    'invert-selection',
    ['ctrl', 'shift', 'i'],
    'InvertSelection',
    'Invert selection',
    'ctrl+shift+i',
  ),
  B('clear-selection', ['esc'], 'ClearSelection', 'Clear selection', 'esc'),
  // ── Search ──
  B('search', ['ctrl', 'f'], 'Search', 'Open search', 'ctrl+f'),
  B('quick-search', ['ctrl', 'p'], 'QuickSearch', 'Quick search (command palette)', 'ctrl+p'),
  B(
    'natural-language-search',
    ['ctrl', 'shift', 'f'],
    'NaturalLanguageSearch',
    'AI-powered search',
    'ctrl+shift+f',
  ),
  // ── View ──
  B(
    'toggle-left-sidebar',
    ['ctrl', 'alt', 's'],
    'ToggleLeftSidebar',
    'Toggle left sidebar',
    'ctrl+alt+s',
  ),
  B(
    'toggle-right-sidebar',
    ['ctrl', 'shift', 'b'],
    'ToggleRightSidebar',
    'Toggle right sidebar',
    'ctrl+shift+b',
  ),
  B('toggle-bottom-panel', ['ctrl', 'j'], 'ToggleBottomPanel', 'Toggle bottom panel', 'ctrl+j'),
  B(
    'toggle-preview',
    ['ctrl', 'shift', 'p'],
    'TogglePreview',
    'Toggle preview panel',
    'ctrl+shift+p',
  ),
  B('view-icons', ['ctrl', '1'], { SetViewMode: { mode: 'medium' } }, 'Icon view', 'ctrl+1'),
  B('view-list', ['ctrl', '2'], { SetViewMode: { mode: 'details' } }, 'List view', 'ctrl+2'),
  B('view-column', ['ctrl', '3'], { SetViewMode: { mode: 'column' } }, 'Column view', 'ctrl+3'),
  B('view-gallery', ['ctrl', '4'], { SetViewMode: { mode: 'gallery' } }, 'Gallery view', 'ctrl+4'),
  B('refresh', ['f5'], 'Refresh', 'Refresh directory', 'f5'),
  B(
    'toggle-hidden',
    ['ctrl', 'shift', '.'],
    'ToggleHiddenFiles',
    'Toggle hidden files',
    'ctrl+shift+.',
  ),
  B('zoom-in', ['ctrl', '='], 'ZoomIn', 'Zoom in', 'ctrl+='),
  B('zoom-out', ['ctrl', '-'], 'ZoomOut', 'Zoom out', 'ctrl+-'),
  // ── Application ──
  B('open-settings', ['ctrl', ','], 'OpenSettings', 'Open settings', 'ctrl+,'),
  B('new-tab', ['ctrl', 't'], 'NewTab', 'Open new tab', 'ctrl+t'),
  B('close-tab', ['ctrl', 'w'], 'CloseTab', 'Close current tab', 'ctrl+w'),
  B('next-tab', ['ctrl', 'tab'], 'NextTab', 'Switch to next tab', 'ctrl+tab'),
  B(
    'prev-tab',
    ['ctrl', 'shift', 'tab'],
    'PreviousTab',
    'Switch to previous tab',
    'ctrl+shift+tab',
  ),
  B(
    'toggle-fullscreen',
    ['ctrl', 'alt', 'f'],
    'ToggleFullscreen',
    'Toggle fullscreen (Finder ⌃⌘F)',
    'ctrl+alt+f',
  ),
  B(
    'toggle-fullscreen-f11',
    ['f11'],
    'ToggleFullscreen',
    'Toggle fullscreen (F11 habit key)',
    'f11',
  ),
  B('new-window', ['ctrl', 'n'], 'NewWindow', 'Open new window', 'ctrl+n'),
  B('quit', ['ctrl', 'q'], 'Quit', 'Quit application', 'ctrl+q'),
  // ── Panels, dialogs & split panes ──
  B(
    'shortcuts-dialog',
    ['ctrl', '/'],
    'ToggleShortcutsDialog',
    'Show shortcut cheat sheet',
    'ctrl+/',
  ),
  B(
    'shortcuts-dialog-shift',
    ['shift', '/'],
    'ToggleShortcutsDialog',
    'Show shortcut cheat sheet',
    'shift+/',
  ),
  B(
    'workspace-layout',
    ['ctrl', 'shift', 'l'],
    'ToggleWorkspaceLayoutDialog',
    'Toggle workspace layout dialog',
    'ctrl+shift+l',
  ),
  B(
    'path-bookmarks',
    ['ctrl', 'b'],
    'ToggleBookmarksDialog',
    'Toggle path bookmarks dialog',
    'ctrl+b',
  ),
  B('split-vertical', ['ctrl', '\\'], 'SplitPaneVertical', 'Split pane vertically', 'ctrl+\\'),
  B(
    'split-horizontal',
    ['ctrl', 'shift', '\\'],
    'SplitPaneHorizontal',
    'Split pane horizontally',
    'ctrl+shift+\\',
  ),
  // ── Terminal / AI ──
  B('open-terminal', ['ctrl', '`'], 'OpenTerminal', 'Open terminal', 'ctrl+`'),
  B('agent-launcher', ['ctrl', 'k'], 'ToggleAgentLauncher', 'Open Agent', 'ctrl+k'),
];
