/**
 * React hooks for extensions.
 *
 * These hooks provide reactive access to Wisp state from within
 * extension panel/preview components rendered via `Sidebar.register()`
 * or `Preview.register()`.
 *
 * They listen for `wisp-state-change` CustomEvents dispatched by the host,
 * so they react instantly without polling.
 */

// React is available as a global in the extension runtime
declare const React: typeof import('react');

interface WispFile {
  name: string;
  path: string;
  is_dir: boolean;
}

interface WispState {
  currentPath: string;
  selectedFiles: WispFile[];
  navigateTo?: (path: string) => void;
}

const getState = (): WispState | undefined => {
  return (window as unknown as Record<string, unknown>).__wisp_state__ as WispState | undefined;
};

/**
 * Returns the current directory path and re-renders when it changes.
 * Listens for `wisp-state-change` events dispatched by the host.
 */
export const useCurrentPath = (): string => {
  const { useState: _useState, useEffect: _useEffect } = React;
  const [path, setPath] = _useState(() => getState()?.currentPath || '');

  _useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;
      if (detail.type === 'currentPath' && typeof detail.value === 'string') {
        setPath(detail.value);
      }
    };
    window.addEventListener('wisp-state-change', handler);
    return () => window.removeEventListener('wisp-state-change', handler);
  }, []);

  return path;
};

/**
 * Returns the currently selected files and re-renders when they change.
 * Listens for `wisp-state-change` events dispatched by the host.
 */
export const useSelectedFiles = (): WispFile[] => {
  const { useState: _useState, useEffect: _useEffect } = React;
  const [files, setFiles] = _useState<WispFile[]>(() => getState()?.selectedFiles || []);

  _useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;
      if (detail.type === 'selectedFiles' && Array.isArray(detail.value)) {
        setFiles(detail.value);
      }
    };
    window.addEventListener('wisp-state-change', handler);
    return () => window.removeEventListener('wisp-state-change', handler);
  }, []);

  return files;
};

/**
 * Navigate to a path programmatically.
 */
export const navigateTo = (path: string): void => {
  const state = getState();
  if (state?.navigateTo) {
    state.navigateTo(path);
  }
};
