import { useState, useEffect, useCallback, useRef } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import type { SortField } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FolderSettings {
  viewMode?: string;
  sortBy?: SortField;
  sortOrder?: 'asc' | 'desc';
  groupByDate?: boolean;
}

interface FolderViewSettingsResult {
  viewMode: string;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  groupByDate: boolean;
  setViewMode: (mode: string) => void;
  setSortBy: (field: SortField) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setGroupByDate: (enabled: boolean) => void;
  toggleSortOrder: () => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_VIEW_MODE = 'details';
const DEFAULT_SORT_BY: SortField = 'dateModified';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'desc';
const DEFAULT_GROUP_BY_DATE = true;

// ── Persistence helpers ───────────────────────────────────────────────────────

const STORAGE_KEY = STORAGE_KEYS.FOLDER_SETTINGS;
const MAX_ENTRIES = 500;

const loadAllSettings = (): Record<string, FolderSettings> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, FolderSettings>;
      }
    }
  } catch (e) {
    console.warn('Failed to parse folder-settings from localStorage:', e);
  }
  return {};
};

const getSettingsForPath = (path: string): FolderSettings | null => {
  const all = loadAllSettings();
  return all[path] ?? null;
};

const saveSettingsForPath = (path: string, settings: FolderSettings): void => {
  const all = loadAllSettings();
  all[path] = { ...all[path], ...settings };
  // LRU eviction — drop oldest keys when over limit
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) {
    delete all[keys[0]];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
};

// ── Global sort (shared by every folder and every pane) ──────────────────────

// The single source of truth for sorting is the `sortBy`/`sortOrder` fields
// inside `wisp:ui-state` — the same fields useLayoutState (OperationBar's
// sort dropdown) reads and writes. Panes listen for the event to re-sort live.
const GLOBAL_SORT_KEY = STORAGE_KEYS.UI_STATE;
const SORT_CHANGED_EVENT = 'wisp-sort-changed';

const readUiState = (): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem(GLOBAL_SORT_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
};

/** Global sort if the user ever picked one; null means "use folder defaults". */
const loadGlobalSort = (): { sortBy?: SortField; sortOrder?: 'asc' | 'desc' } | null => {
  const state = readUiState();
  if (!('sortBy' in state) && !('sortOrder' in state)) return null;
  return state as { sortBy?: SortField; sortOrder?: 'asc' | 'desc' };
};

const saveGlobalSort = (patch: { sortBy?: SortField; sortOrder?: 'asc' | 'desc' }): void => {
  const next = { ...readUiState(), ...patch };
  localStorage.setItem(GLOBAL_SORT_KEY, JSON.stringify(next));
  // Live-sync every open pane
  window.dispatchEvent(
    new CustomEvent(SORT_CHANGED_EVENT, {
      detail: { sortBy: next.sortBy, sortOrder: next.sortOrder },
    }),
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Per-folder view settings with global sorting. View mode and date grouping
 * persist per folder path (localStorage), but the sort field/order is a
 * single global choice: changing it anywhere applies to every folder and
 * every open pane (synced live via a window event). Until the user picks a
 * sort once, folders start reverse-chronological and grouped by date.
 *
 * The `globalViewMode` parameter provides a baseline from the smart-view
 * auto-detection system — it's used only when no per-folder view setting
 * exists yet.
 */
export const useFolderViewSettings = (
  currentPath: string,
  globalViewMode: string,
): FolderViewSettingsResult => {
  // Compute initial values for this path. Stored global sorting and stored
  // per-folder grouping always win over the first-open defaults.
  const computeDefaults = useCallback(
    (
      path: string,
    ): { viewMode: string; sortBy: SortField; sortOrder: 'asc' | 'desc'; groupByDate: boolean } => {
      const saved = getSettingsForPath(path);
      const globalSort = loadGlobalSort();

      return {
        viewMode: saved?.viewMode ?? globalViewMode ?? DEFAULT_VIEW_MODE,
        sortBy: globalSort?.sortBy ?? DEFAULT_SORT_BY,
        sortOrder: globalSort?.sortOrder ?? DEFAULT_SORT_ORDER,
        groupByDate: saved?.groupByDate ?? DEFAULT_GROUP_BY_DATE,
      };
    },
    [globalViewMode],
  );

  const [viewMode, setViewModeState] = useState(() => computeDefaults(currentPath).viewMode);
  const [sortBy, setSortByState] = useState(() => computeDefaults(currentPath).sortBy);
  const [sortOrder, setSortOrderState] = useState(() => computeDefaults(currentPath).sortOrder);
  const [groupByDate, setGroupByDateState] = useState(
    () => computeDefaults(currentPath).groupByDate,
  );

  // Track the path so we can reload settings on navigation
  const prevPathRef = useRef(currentPath);

  // When the path changes, reload per-folder view/grouping; the global sort
  // applies unchanged (it is folder-independent by design).
  useEffect(() => {
    if (prevPathRef.current === currentPath) return;
    prevPathRef.current = currentPath;

    const defaults = computeDefaults(currentPath);
    setViewModeState(defaults.viewMode);
    setSortByState(defaults.sortBy);
    setSortOrderState(defaults.sortOrder);
    setGroupByDateState(defaults.groupByDate);
  }, [currentPath, computeDefaults]);

  // Follow global sort changes made from any other pane
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sortBy?: SortField; sortOrder?: 'asc' | 'desc' }>).detail;
      if (detail?.sortBy) setSortByState(detail.sortBy);
      if (detail?.sortOrder) setSortOrderState(detail.sortOrder);
    };
    window.addEventListener(SORT_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SORT_CHANGED_EVENT, handler);
  }, []);

  // Sync viewMode when globalViewMode (from useSmartView) changes for this path
  // Only apply if the user hasn't explicitly saved settings for this folder
  const prevGlobalViewRef = useRef(globalViewMode);
  useEffect(() => {
    if (prevGlobalViewRef.current === globalViewMode) return;
    prevGlobalViewRef.current = globalViewMode;

    const saved = getSettingsForPath(currentPath);
    if (!saved?.viewMode) {
      setViewModeState(globalViewMode);
    }
  }, [globalViewMode, currentPath]);

  // ── Setters that persist to localStorage ────────────────────────────────────

  const setViewMode = useCallback(
    (mode: string) => {
      setViewModeState(mode);
      saveSettingsForPath(currentPath, { viewMode: mode });
    },
    [currentPath],
  );

  const setSortBy = useCallback((field: SortField) => {
    setSortByState(field);
    saveGlobalSort({ sortBy: field });
  }, []);

  const setSortOrder = useCallback((order: 'asc' | 'desc') => {
    setSortOrderState(order);
    saveGlobalSort({ sortOrder: order });
  }, []);

  const setGroupByDate = useCallback(
    (enabled: boolean) => {
      setGroupByDateState(enabled);
      saveSettingsForPath(currentPath, { groupByDate: enabled });
    },
    [currentPath],
  );

  const toggleSortOrder = useCallback(() => {
    setSortOrderState((prev) => {
      const next = prev === 'asc' ? 'desc' : 'asc';
      saveGlobalSort({ sortOrder: next });
      return next;
    });
  }, []);

  return {
    viewMode,
    sortBy,
    sortOrder,
    groupByDate,
    setViewMode,
    setSortBy,
    setSortOrder,
    setGroupByDate,
    toggleSortOrder,
  };
};
