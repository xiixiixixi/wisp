import type { KeyboardEvent } from 'react';
import type { ShelfCloudShare, ShelfSettings } from '@wisp/sdk';

export type ShelfActionPreset = ShelfSettings['customActions'][number];
export type ShelfWatchedFolder = ShelfSettings['watchedFolders'][number];
export type ShelfCloudAccount = ShelfSettings['cloudAccounts'][number];
export type ShelfShortcut = ShelfSettings['shortcutBindings'][number];

export const SHELF_ACTION_KINDS = [
  'copy',
  'move',
  'archive',
  'openApp',
  'rename',
  'resizeImages',
  'compressImages',
  'convertImages',
  'imagePDF',
  'extractText',
  'stitchImages',
  'mergePDFs',
  'protectPDF',
  'desktopPicture',
] as const;
export const SHELF_CLOUD_PROVIDERS = [
  'custom',
  'icloud',
  's3',
  'dropbox',
  'gdrive',
  'onedrive',
  'imgur',
];
export const SHELF_FILE_TYPES = [
  'all',
  'images',
  'documents',
  'text',
  'audio',
  'video',
  'archives',
];
export const shelfID = () => crypto.randomUUID().toUpperCase();

export const newShelfAction = (): ShelfActionPreset => ({
  id: shelfID(),
  name: '',
  kind: 'copy',
  destination: '',
  nameTemplate: '',
  width: 1600,
  quality: 0.8,
  format: 'jpeg',
  application: '',
  password: '',
  findText: '',
  replaceText: '',
  renameMode: 'template',
  caseSensitive: false,
  toClipboard: false,
  counterStart: 1,
  resizeMode: 'edge',
  maxWidth: 1600,
  maxHeight: 1600,
  scalePercent: 100,
  afterOutput: 'keep',
});

export const newShelfWatchedFolder = (): ShelfWatchedFolder => ({
  id: shelfID(),
  path: '',
  enabled: true,
  fileType: 'all',
  extensions: [],
  collectionDelay: 3,
  nameCondition: 'any',
  nameText: '',
  perFileNewShelf: false,
});

export const newShelfCloud = (): ShelfCloudAccount => ({
  id: shelfID(),
  name: '',
  provider: 'custom',
  endpoint: '',
  bucket: '',
  region: 'us-east-1',
  publicBaseURL: '',
  credentialKey: shelfID(),
  pathTemplate: '{filename}',
  presignEnabled: false,
  presignExpiry: '7d',
});

export const parseShelfExtensions = (text: string): string[] =>
  [
    ...new Set(
      text
        .split(/[,，;；\s]+/u)
        .map((value) => value.replace(/^\.+/, '').toLowerCase())
        .filter(Boolean),
    ),
  ].sort();

export const validShelfWebURL = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

// #63：上传路径模板。校验规则与引擎端 CloudPathTemplate 逐条对齐（错误键见 errors.*）。
export const SHELF_PATH_TEMPLATE_PLACEHOLDERS = ['{filename}', '{date}'];

export const shelfPathTemplateErrorKey = (template: string): string | null => {
  if (!template) return 'pathTemplateEmpty';
  if (template !== template.trim()) return 'pathTemplateWhitespace';
  if (template.startsWith('/')) return 'pathTemplateLeadingSlash';
  if (template.includes('//')) return 'pathTemplateDoubleSlash';
  if (/[?*\\]/u.test(template)) return 'pathTemplateForbidden';
  const placeholders = template.match(/\{[^}]*\}/gu) ?? [];
  for (const placeholder of placeholders) {
    if (!SHELF_PATH_TEMPLATE_PLACEHOLDERS.includes(placeholder)) return 'pathTemplatePlaceholders';
  }
  if (/\{[^}]*$/u.test(template)) return 'pathTemplatePlaceholders';
  return null;
};

/** 首尾去空白；空值回落 {filename}（与引擎端 normalized 同口径）。 */
export const normalizedShelfPathTemplate = (template: string): string => {
  const trimmed = template.trim();
  return trimmed || '{filename}';
};

// #64：预签名到期档位（默认 7 天；引擎端 S3PresignExpiry 同表）。
export const SHELF_PRESIGN_EXPIRY = ['1h', '1d', '7d', '30d'] as const;

export const normalizedShelfPresignExpiry = (value: string | undefined): string =>
  value && (SHELF_PRESIGN_EXPIRY as readonly string[]).includes(value) ? value : '7d';

// #67：只有支持远端 DELETE 的提供商开放「删除并撤销」。
export const SHELF_REVOKABLE_PROVIDERS = ['custom', 's3', 'imgur'];

export const shelfProviderCanRevoke = (provider: string): boolean =>
  SHELF_REVOKABLE_PROVIDERS.includes(provider.toLowerCase());

export const isShelfShareExpired = (record: ShelfCloudShare, now = Date.now()): boolean =>
  typeof record.expiresAt === 'number' && record.expiresAt <= now;

/** #67：上传历史过滤 all/valid/expired；无到期字段的记录视为不过期。 */
export const filterShelfShareHistory = (
  records: ShelfCloudShare[],
  filter: 'all' | 'valid' | 'expired',
  now = Date.now(),
): ShelfCloudShare[] => {
  switch (filter) {
    case 'valid':
      return records.filter((record) => !isShelfShareExpired(record, now));
    case 'expired':
      return records.filter((record) => isShelfShareExpired(record, now));
    default:
      return records;
  }
};

/** #67：这条记录能不能「删除并撤销」——提供商支持且至少有一个可撤销句柄。 */
export const shelfShareCanRevoke = (record: ShelfCloudShare, accounts: ShelfCloudAccount[]): boolean => {
  if (!record.accountID) return false;
  const account = accounts.find((entry) => entry.id === record.accountID);
  if (!account || !shelfProviderCanRevoke(account.provider)) return false;
  return Boolean(record.deleteHandles?.some((handle) => handle != null && handle !== ''));
};

const CARBON_KEYS: Record<string, number> = {
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit6: 22,
  Digit5: 23,
  Equal: 24,
  Digit9: 25,
  Digit7: 26,
  Minus: 27,
  Digit8: 28,
  Digit0: 29,
  BracketRight: 30,
  KeyO: 31,
  KeyU: 32,
  BracketLeft: 33,
  KeyI: 34,
  KeyP: 35,
  Enter: 36,
  KeyL: 37,
  KeyJ: 38,
  Quote: 39,
  KeyK: 40,
  Semicolon: 41,
  Backslash: 42,
  Comma: 43,
  Slash: 44,
  KeyN: 45,
  KeyM: 46,
  Period: 47,
  Tab: 48,
  Space: 49,
  Backquote: 50,
  Backspace: 51,
  Escape: 53,
  F17: 64,
  NumpadDecimal: 65,
  NumpadMultiply: 67,
  NumpadAdd: 69,
  NumpadDivide: 75,
  NumpadEnter: 76,
  NumpadSubtract: 78,
  F18: 79,
  F19: 80,
  NumpadEqual: 81,
  Numpad0: 82,
  Numpad1: 83,
  Numpad2: 84,
  Numpad3: 85,
  Numpad4: 86,
  Numpad5: 87,
  Numpad6: 88,
  Numpad7: 89,
  F20: 90,
  Numpad8: 91,
  Numpad9: 92,
  F5: 96,
  F6: 97,
  F7: 98,
  F3: 99,
  F8: 100,
  F9: 101,
  F11: 103,
  F13: 105,
  F16: 106,
  F14: 107,
  F10: 109,
  F12: 111,
  F15: 113,
  Insert: 114,
  Home: 115,
  PageUp: 116,
  Delete: 117,
  F4: 118,
  End: 119,
  F2: 120,
  PageDown: 121,
  F1: 122,
  ArrowLeft: 123,
  ArrowRight: 124,
  ArrowDown: 125,
  ArrowUp: 126,
};

export const captureShelfShortcut = (
  event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'>,
) => {
  const keyCode = CARBON_KEYS[event.code];
  if (keyCode === undefined) return null;
  const modifiers =
    (event.metaKey ? 256 : 0) |
    (event.shiftKey ? 512 : 0) |
    (event.altKey ? 2048 : 0) |
    (event.ctrlKey ? 4096 : 0);
  return { keyCode, modifiers };
};

export const displayShelfShortcut = (
  shortcut: ShelfShortcut,
  translate: (key: string) => string,
) => {
  const modifierLabels = [
    [4096, 'Control'],
    [2048, 'Option'],
    [512, 'Shift'],
    [256, 'Command'],
  ] as const;
  const parts = modifierLabels
    .filter(([mask]) => Boolean(shortcut.modifiers & mask))
    .map(([, label]) => translate(`shelf.preferences.keys.${label}`));
  const code = Object.entries(CARBON_KEYS).find(([, value]) => value === shortcut.keyCode)?.[0];
  const key = code?.replace(/^Key|^Digit/, '');
  let label = String(shortcut.keyCode);
  if (code) {
    const plainKey = code.startsWith('Key') || code.startsWith('Digit') || /^F\d+$/.test(code);
    label = plainKey ? key! : translate(`shelf.preferences.keys.${code}`);
  }
  return [...parts, label].join(' + ');
};

export const moveShelfChoice = (items: string[], index: number, offset: number) => {
  const next = [...items];
  const target = index + offset;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};
