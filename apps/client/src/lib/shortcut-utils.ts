/**
 * Shared keyboard shortcut utilities.
 * Used by both the `useShortcuts` hook and the KeyboardShortcutsSettings UI.
 */
import i18n from '@/i18n';

/** macOS detection for shortcut DISPLAY — bindings store the token "ctrl",
 *  which means the platform's primary modifier (⌘ on macOS, Ctrl elsewhere). */
export const isMacPlatform = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Macintosh|Mac OS X|Macintosh Intel/i.test(ua) || /Mac/.test(navigator.platform || '');
};

/** Convert "ctrl+shift+b" to a platform-native display string.
 *  macOS renders Finder-style glyphs (⌘⇧B); other platforms render
 *  "Ctrl + Shift + B". */
export const formatKeyComboForDisplay = (keyCombination: string): string => {
  if (!keyCombination) return '';

  if (isMacPlatform()) {
    // Finder style: glyphs, no separators — ⌘⇧N, ⌥⌘V, ⌘⌫, ⌘↓
    const symbols: Record<string, string> = {
      ctrl: '⌘',
      meta: '⌘',
      alt: '⌥',
      shift: '⇧',
      esc: '⎋',
      del: '⌫',
      enter: '↩',
      space: 'Space',
      backspace: '⌫',
      tab: '⇥',
      up: '↑',
      down: '↓',
      left: '←',
      right: '→',
    };
    return keyCombination
      .split('+')
      .map((part) => {
        if (symbols[part]) return symbols[part];
        if (part.startsWith('f') && !isNaN(Number(part.slice(1)))) return part.toUpperCase();
        return part.length === 1 ? part.toUpperCase() : part;
      })
      .join('');
  }

  return keyCombination
    .split('+')
    .map((part) => {
      switch (part) {
        case 'ctrl':
          return 'Ctrl';
        case 'alt':
          return 'Alt';
        case 'shift':
          return 'Shift';
        case 'meta':
          return 'Meta';
        case 'esc':
          return 'Esc';
        case 'del':
          return 'Del';
        case 'enter':
          return 'Enter';
        case 'space':
          return 'Space';
        case 'backspace':
          return 'Backspace';
        case 'tab':
          return 'Tab';
        case 'up':
          return '↑';
        case 'down':
          return '↓';
        case 'left':
          return '←';
        case 'right':
          return '→';
        default:
          // Function keys (f1-f12) and single chars
          if (part.startsWith('f') && !isNaN(Number(part.slice(1)))) return part.toUpperCase();
          return part.length === 1 ? part.toUpperCase() : part;
      }
    })
    .join(' + ');
};

/** Normalize a KeyboardEvent into a string like "ctrl+shift+b" */
export const getKeyString = (event: KeyboardEvent): string => {
  const parts: string[] = [];

  if (event.ctrlKey || event.metaKey) {
    parts.push('ctrl');
  }
  if (event.altKey) {
    parts.push('alt');
  }
  if (event.shiftKey) {
    parts.push('shift');
  }

  let key = event.key.toLowerCase();

  // On macOS, Option+letter produces special glyphs (⌥C → "ç", ⌥S → "ß") and
  // dead keys report key === "Dead", so event.key never matches the authored
  // binding. With Alt held, resolve letters/digits from the layout-independent
  // physical event.code instead — combos like ⌥⌘C must match "ctrl+alt+c".
  if (event.altKey) {
    if (/^Key[A-Z]$/.test(event.code)) {
      key = event.code.slice(3).toLowerCase();
    } else if (/^Digit\d$/.test(event.code)) {
      key = event.code.slice(5);
    }
  }

  // With Shift held, browsers report the shifted character (⇧. → ">"), so
  // map shifted punctuation back to its base key. The combo already carries
  // "shift", keeping bindings like "ctrl+shift+." matchable (Finder's
  // show-hidden-files ⌘⇧.). Full-width forms cover CJK input methods.
  if (event.shiftKey) {
    const shifted: Record<string, string> = {
      '>': '.',
      '<': ',',
      '{': '[',
      '}': ']',
      ':': ';',
      '"': "'",
      '~': '`',
      '|': '\\',
      '?': '/',
      _: '-',
      '+': '=',
      '。': '.',
      '，': ',',
      '：': ';',
      '「': '[',
      '」': ']',
      '·': '`',
    };
    key = shifted[key] ?? key;
  }

  switch (key) {
    case ' ':
      key = 'space';
      break;
    case 'arrowup':
      key = 'up';
      break;
    case 'arrowdown':
      key = 'down';
      break;
    case 'arrowleft':
      key = 'left';
      break;
    case 'arrowright':
      key = 'right';
      break;
    case 'escape':
      key = 'esc';
      break;
    case 'enter':
      key = 'enter';
      break;
    case 'backspace':
      key = 'backspace';
      break;
    case 'delete':
      key = 'del';
      break;
  }

  // Skip lone modifier keys
  if (['control', 'alt', 'shift', 'meta'].includes(key)) {
    return parts.join('+');
  }

  parts.push(key);
  return parts.join('+');
};

/** Map action string → category id */
export const ACTION_CATEGORIES: Record<string, string> = {
  Copy: 'file-operations',
  CopyPath: 'file-operations',
  Cut: 'file-operations',
  Paste: 'file-operations',
  PasteMove: 'file-operations',
  Delete: 'file-operations',
  Rename: 'file-operations',
  NewFile: 'file-operations',
  NewFolder: 'file-operations',
  Duplicate: 'file-operations',
  Open: 'file-operations',
  Properties: 'file-operations',
  QuickLook: 'file-operations',

  Undo: 'file-operations',
  Redo: 'file-operations',

  NavigateUp: 'navigation',
  NavigateBack: 'navigation',
  NavigateForward: 'navigation',
  GoHome: 'navigation',
  GoToPath: 'navigation',

  SelectAll: 'selection',
  ClearSelection: 'selection',
  InvertSelection: 'selection',

  Search: 'search',
  QuickSearch: 'search',
  NaturalLanguageSearch: 'search',
  FilterFiles: 'search',

  Refresh: 'view',
  ToggleHiddenFiles: 'view',
  TogglePreview: 'view',
  ToggleLeftSidebar: 'view',
  ToggleRightSidebar: 'view',
  ToggleBottomPanel: 'view',
  SwitchViewMode: 'view',
  ZoomIn: 'view',
  ZoomOut: 'view',

  OpenSettings: 'application',
  ToggleFullscreen: 'application',
  Quit: 'application',
  NewWindow: 'application',
  NewTab: 'application',
  CloseTab: 'application',
  NextTab: 'application',
  PreviousTab: 'application',

  ToggleShortcutsDialog: 'application',
  ToggleWorkspaceLayoutDialog: 'application',
  ToggleBookmarksDialog: 'application',
  SplitPaneVertical: 'application',
  SplitPaneHorizontal: 'application',

  OpenTerminal: 'terminal',
  ToggleAgentLauncher: 'terminal',
  ToggleAgentWorkspace: 'terminal',
  OpenAIAssistant: 'terminal',
  OpenExtensions: 'terminal',
};

/** Human-readable labels for each action */
export const ACTION_LABELS: Record<string, string> = {
  Copy: 'Copy',
  CopyPath: 'Copy Path as Pathname',
  Cut: 'Cut',
  Paste: 'Paste',
  PasteMove: 'Move Here',
  Delete: 'Delete',
  Rename: 'Rename',
  NewFile: 'New File',
  NewFolder: 'New Folder',
  Duplicate: 'Duplicate',
  Open: 'Open',
  Properties: 'Get Info',
  QuickLook: 'Quick Look',

  Undo: 'Undo',
  Redo: 'Redo',

  NavigateUp: 'Go to Parent',
  NavigateBack: 'Go Back',
  NavigateForward: 'Go Forward',
  GoHome: 'Go Home',
  GoToPath: 'Go to Path',

  SelectAll: 'Select All',
  ClearSelection: 'Clear Selection',
  InvertSelection: 'Invert Selection',

  Search: 'Search',
  QuickSearch: 'Quick Search',
  NaturalLanguageSearch: 'AI Search',
  FilterFiles: 'Filter Files',

  Refresh: 'Refresh',
  ToggleHiddenFiles: 'Toggle Hidden Files',
  TogglePreview: 'Toggle Preview',
  ToggleLeftSidebar: 'Toggle Left Sidebar',
  ToggleRightSidebar: 'Toggle Right Sidebar',
  ToggleBottomPanel: 'Toggle Bottom Panel',
  SwitchViewMode: 'Switch View Mode',
  ZoomIn: 'Zoom In',
  ZoomOut: 'Zoom Out',

  OpenSettings: 'Open Settings',
  ToggleFullscreen: 'Toggle Fullscreen',
  Quit: 'Quit',
  NewWindow: 'New Window',
  NewTab: 'New Tab',
  CloseTab: 'Close Tab',
  NextTab: 'Next Tab',
  PreviousTab: 'Previous Tab',

  ToggleShortcutsDialog: 'Keyboard Shortcuts',
  ToggleWorkspaceLayoutDialog: 'Workspace Layout',
  ToggleBookmarksDialog: 'Path Bookmarks',
  SplitPaneVertical: 'Split Pane Vertically',
  SplitPaneHorizontal: 'Split Pane Horizontally',

  OpenTerminal: 'Open Terminal',
  ToggleAgentLauncher: 'Open Agent',
  ToggleAgentWorkspace: 'Open Agent',
  OpenAIAssistant: 'AI Assistant',
  OpenExtensions: 'Extensions',
};

/** Display names for the view modes reachable via ⌘1-⌘4 */
export const VIEW_MODE_LABELS: Record<string, string> = {
  large: 'Large Icons',
  medium: 'Icons',
  small: 'Small Icons',
  tiles: 'Tiles',
  content: 'Content',
  list: 'List',
  details: 'Details',
  tree: 'Tree',
  gallery: 'Gallery',
  column: 'Columns',
};

/** Display names for the special folders reachable via GoToSpecial */
export const SPECIAL_FOLDER_LABELS: Record<string, string> = {
  desktop: 'Desktop',
  downloads: 'Downloads',
  documents: 'Documents',
  applications: 'Applications',
  home: 'Home',
};

/** Get category for a ShortcutAction (handles string, SetViewMode/GoToSpecial and ExtensionAction) */
export const getCategoryForAction = (action: string | Record<string, unknown>): string => {
  if (typeof action !== 'string') {
    if ('SetViewMode' in action) return 'view';
    if ('GoToSpecial' in action) return 'navigation';
    return 'extensions';
  }
  return ACTION_CATEGORIES[action] || 'other';
};

/** Get display label for a ShortcutAction */
export const getLabelForAction = (action: string | Record<string, unknown>): string => {
  if (typeof action !== 'string') {
    if ('SetViewMode' in action) {
      const mode = (action.SetViewMode as { mode: string }).mode;
      return i18n.t('shortcutActions.SetViewMode', {
        defaultValue: 'Switch to {{mode}} view',
        mode: i18n.t(`shortcutActions.viewMode.${mode}`, {
          defaultValue: VIEW_MODE_LABELS[mode] || mode,
        }),
      });
    }
    if ('GoToSpecial' in action) {
      const folder = (action.GoToSpecial as { folder: string }).folder;
      return i18n.t(`shortcutActions.goTo.${folder}`, {
        defaultValue: `Go to ${SPECIAL_FOLDER_LABELS[folder] || folder}`,
      });
    }
    if ('ExtensionAction' in action) {
      const ea = action.ExtensionAction as { extension_id: string; action_id: string };
      return `Extension: ${ea.extension_id} / ${ea.action_id}`;
    }
    return String(action);
  }
  return i18n.t(`shortcutActions.${action}`, { defaultValue: ACTION_LABELS[action] || action });
};
