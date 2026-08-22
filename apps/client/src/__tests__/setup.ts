import '@testing-library/jest-dom';
import React from 'react';
import { vi } from 'vitest';

// Node's experimental storage globals can shadow jsdom's storage with an
// unavailable value. Use a Storage-prototype-backed in-memory instance so
// application code and tests spying on Storage.prototype see the same API.
const storageValues = new Map<string, string>();
const storagePrototype = window.Storage.prototype;
Object.defineProperties(storagePrototype, {
  length: {
    configurable: true,
    get: () => storageValues.size,
  },
  clear: {
    configurable: true,
    writable: true,
    value: () => storageValues.clear(),
  },
  getItem: {
    configurable: true,
    writable: true,
    value: (key: string) => storageValues.get(String(key)) ?? null,
  },
  key: {
    configurable: true,
    writable: true,
    value: (index: number) => Array.from(storageValues.keys())[index] ?? null,
  },
  removeItem: {
    configurable: true,
    writable: true,
    value: (key: string) => storageValues.delete(String(key)),
  },
  setItem: {
    configurable: true,
    writable: true,
    value: (key: string, value: string) => storageValues.set(String(key), String(value)),
  },
});
const memoryLocalStorage = Object.create(storagePrototype) as Storage;
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: memoryLocalStorage,
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: memoryLocalStorage,
});

// Mock react-i18next so components using useTranslation() work in tests
vi.mock('react-i18next', async () => {
  const { default: english } = await import('@/locales/en.json');

  const translate = (key: string, opts?: Record<string, unknown>) => {
    const segments = key.split('.');
    let value: unknown = english;
    for (const segment of segments) {
      if (!value || typeof value !== 'object' || !(segment in value)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[segment];
    }

    const fallback = key.includes('.') ? segments.at(-1)! : key;
    let base = fallback;
    if (typeof opts?.defaultValue === 'string') base = opts.defaultValue;
    if (typeof value === 'string') base = value;

    if (!opts) return base;
    return Object.entries(opts).reduce(
      (result, [name, replacement]) => result.replaceAll(`{{${name}}}`, String(replacement)),
      base,
    );
  };

  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: React.ReactNode }) => children,
    initReactI18next: { type: '3rdParty', init: vi.fn() },
  };
});

// The client is a desktop file manager. Model a Tauri webview explicitly while
// routing every native call through the mocks below.
const tauriInternalsMock = {};
Object.defineProperty(globalThis, '__TAURI_INTERNALS__', {
  configurable: true,
  value: tauriInternalsMock,
});
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  configurable: true,
  value: tauriInternalsMock,
});

// Mock Tauri API
const mockInvoke = vi.fn().mockImplementation((command, _args) => {
  // Default return values for common commands
  switch (command) {
    case 'read_directory':
      return Promise.resolve([]);
    default:
      return Promise.resolve(null);
  }
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
  convertFileSrc: vi.fn((path: string) => `tauri://asset/${path}`),
}));

// Mock Tauri event API
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock Tauri dialog API
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

// Mock TauriAPI module
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readDirectory: vi.fn(() => Promise.resolve([])),
    getFileIcon: vi.fn(() => '📄'),
    formatFileSize: vi.fn(() => '1 KB'),
    formatDate: vi.fn(() => '2024-01-01'),
    openTrash: vi.fn(() => Promise.resolve()),
    restoreFromTrash: vi.fn(() => Promise.resolve()),
    permanentlyDeleteFromTrash: vi.fn(() => Promise.resolve()),
    getTrashItems: vi.fn(() => Promise.resolve([])),
    calculateFolderSize: vi.fn(() =>
      Promise.resolve({
        total_size: 1024,
        file_count: 1,
        dir_count: 0,
        is_cached: false,
        cache_timestamp: 0,
      }),
    ),
    getCachedFolderSizes: vi.fn(() => Promise.resolve({})),
    clearFolderSizeCache: vi.fn(() => Promise.resolve()),
    readTextFile: vi.fn(() => Promise.resolve('')),
  },
  FileEntry: {},
  FolderSizeInfo: {},
  TrashItem: {},
}));

// Global mocks
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock React Router for testing
// NOTE: Avoid require('react') inside vi.mock factory - it creates a separate CJS
// React instance that conflicts with the ESM React used by components, causing
// "Cannot read properties of null (reading 'useState')" errors.
vi.mock('wouter', async () => {
  const React = await import('react');
  return {
    useLocation: vi.fn(() => ['/test', vi.fn()]),
    Route: ({ children }: { children?: React.ReactNode }) => children,
    Link: ({ children, href }: { children?: React.ReactNode; href?: string }) =>
      React.createElement('a', { href }, children),
  };
});

// Mock the utils functions
vi.mock('@/lib/utils', () => ({
  getFileIcon: vi.fn((file: { is_dir: boolean }) =>
    React.createElement('svg', { 'data-testid': file.is_dir ? 'FolderClosed' : 'File' }),
  ),
  renderIcon: vi.fn((name: string, size?: number | string) =>
    React.createElement('svg', { 'data-testid': name, width: size, height: size }),
  ),
  isValidIconName: vi.fn(() => true),
  ICON_NAMES: ['Folder', 'FileText', 'Image', 'Music', 'Star'],
  formatFileSize: vi.fn((bytes: number) => `${bytes} B`),
  formatDate: vi.fn((timestamp: number) => new Date(timestamp).toLocaleDateString()),
  getDateGroupTranslationKey: vi.fn((group: string) => group),
  sortFiles: vi.fn((files: unknown[]) => files),
  cn: vi.fn((...classes: unknown[]) => classes.filter(Boolean).join(' ')),
  applyFontSize: vi.fn(),
  applyTheme: vi.fn(),
  loadFontSize: vi.fn(),
}));

// jsdom doesn't implement scrollIntoView
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}
