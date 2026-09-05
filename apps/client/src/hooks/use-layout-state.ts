import { useState, useCallback, useEffect, useRef } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { patchUiState } from '@/lib/ui-state';
import type { SortField } from '@/lib/utils';

// ── Helpers for persisting UI state to localStorage ──────────────────────────
const UI_STATE_KEY = STORAGE_KEYS.UI_STATE;

const loadUiState = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && key in parsed) return parsed[key] as T;
    }
  } catch (e) {
    console.warn('Failed to parse stored UI state:', e);
  }
  return fallback;
};

// ── Types ────────────────────────────────────────────────────────────────────

export type BottomPanelTabId =
  | 'terminal'
  | 'activity-log'
  | 'notifications'
  | 'clipboard'
  | 'changes'
  | 'properties'
  | (string & Record<never, never>); // Allow extension-registered tab IDs

export interface LayoutState {
  // Panel collapse states
  leftSidebarCollapsed: boolean;
  setLeftSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  bottomPanelCollapsed: boolean;
  setBottomPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  // Panel sizes
  leftSidebarWidth: number;
  setLeftSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  rightSidebarWidth: number;
  setRightSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  bottomPanelHeight: number;
  setBottomPanelHeight: React.Dispatch<React.SetStateAction<number>>;

  // Resize handlers
  handleLeftResize: (delta: number) => void;
  handleRightResize: (delta: number) => void;
  handleBottomResize: (delta: number) => void;

  // Panel tabs
  rightPanelTab: string;
  setRightPanelTab: React.Dispatch<React.SetStateAction<string>>;
  bottomPanelTab: BottomPanelTabId;
  setBottomPanelTab: React.Dispatch<React.SetStateAction<BottomPanelTabId>>;

  // Search panel
  searchPanelOpen: boolean;
  setSearchPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // View mode
  viewMode: string;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;

  // Sorting
  sortBy: SortField;
  setSortBy: React.Dispatch<React.SetStateAction<SortField>>;
  sortOrder: 'asc' | 'desc';
  setSortOrder: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export const useLayoutState = (): LayoutState => {
  // Panel collapse states
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    loadUiState('leftSidebarCollapsed', false),
  );
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() =>
    loadUiState('rightSidebarCollapsed', true),
  );
  const [bottomPanelCollapsed, setBottomPanelCollapsed] = useState(() =>
    loadUiState('bottomPanelCollapsed', true),
  );

  // Panel tabs
  const [rightPanelTab, setRightPanelTab] = useState<string>(() => {
    const stored = loadUiState<string>('rightPanelTab', 'preview');
    // 'chat' merged into 'agent-manager'; 'tokenizer'/'extensions' panels removed
    if (stored === 'chat') return 'agent-manager';
    if (stored === 'tokenizer' || stored === 'extensions') return 'preview';
    return stored;
  });
  const [bottomPanelTab, _setBottomPanelTabRaw] = useState<BottomPanelTabId>(() => {
    const stored = loadUiState<string>('bottomPanelTab', 'terminal');
    // The activity-log / changes / notifications tabs merged into 'events'
    if (stored === 'activity-log' || stored === 'changes' || stored === 'notifications') {
      return 'events';
    }
    // Migrate old tab IDs that were merged into 'activity-log'
    if (stored === 'output' || stored === 'activity' || stored === 'history') return 'events';
    if (stored === 'agents') return 'terminal';
    return stored as BottomPanelTabId;
  });

  // Wrapped setter: switching the bottom panel tab automatically expands the panel
  // so that context menu actions (Properties, Open in Terminal, etc.) reveal the panel.
  const setBottomPanelTab: React.Dispatch<React.SetStateAction<BottomPanelTabId>> = useCallback(
    (action: React.SetStateAction<BottomPanelTabId>) => {
      _setBottomPanelTabRaw(action);
      setBottomPanelCollapsed(false);
    },
    // setBottomPanelCollapsed is a stable useState setter

    [],
  );

  // Search panel
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);

  // Panel sizes
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    loadUiState('leftSidebarWidth', 240),
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    loadUiState('rightSidebarWidth', 320),
  );
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() =>
    loadUiState('bottomPanelHeight', 192),
  );

  // Resize handlers
  const handleLeftResize = useCallback((delta: number) => {
    setLeftSidebarWidth((w) => Math.min(480, Math.max(180, w + delta)));
  }, []);
  const handleRightResize = useCallback((delta: number) => {
    setRightSidebarWidth((w) => Math.min(560, Math.max(240, w - delta)));
  }, []);
  const handleBottomResize = useCallback((delta: number) => {
    setBottomPanelHeight((h) => Math.min(500, Math.max(120, h - delta)));
  }, []);

  // ── Responsive panel collapsing ──────────────────────────────────────────
  // When the window gets too small for the file area to stay usable, panels
  // fold by priority (inspector first, then the sidebar; the bottom panel
  // folds on short windows) instead of every pane squishing. Panels the
  // layout hid itself are restored when space returns; panels the user
  // closed stay closed — user actions always win over the automation.
  const COLLAPSE_W = 560;
  const RESTORE_W = 640; // hysteresis so dragging the window edge doesn't flap
  const COLLAPSE_H = 460;
  const RESTORE_H = 540;

  const autoHidden = useRef({ left: false, right: false, bottom: false });
  // The flags survive reloads: an auto-collapsed panel must come back on the
  // next launch when the window is wide again, unlike a user-closed one.
  const [autoHiddenPanels, setAutoHiddenPanels] = useState<{
    left: boolean;
    right: boolean;
    bottom: boolean;
  }>(() => loadUiState('autoHiddenPanels', { left: false, right: false, bottom: false }));
  autoHidden.current = autoHiddenPanels;
  useEffect(() => {
    patchUiState({ autoHiddenPanels });
  }, [autoHiddenPanels]);
  const markAutoHidden = (next: { left: boolean; right: boolean; bottom: boolean }) => {
    setAutoHiddenPanels((prev) =>
      prev.left === next.left && prev.right === next.right && prev.bottom === next.bottom
        ? prev
        : next,
    );
  };
  const liveRef = useRef({
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    bottomPanelCollapsed,
    leftSidebarWidth,
    rightSidebarWidth,
  });
  liveRef.current = {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    bottomPanelCollapsed,
    leftSidebarWidth,
    rightSidebarWidth,
  };

  useEffect(() => {
    const evaluate = () => {
      const s = liveRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const flags = { ...autoHidden.current };

      // Horizontal: the inspector folds before the sidebar; both restore in
      // reverse order, and only panels this logic hid come back on their own.
      const space = (leftOpen: boolean, rightOpen: boolean) =>
        vw - (leftOpen ? s.leftSidebarWidth : 0) - (rightOpen ? s.rightSidebarWidth : 0);
      let leftOpen = !s.leftSidebarCollapsed;
      let rightOpen = !s.rightSidebarCollapsed;
      if (space(leftOpen, rightOpen) < COLLAPSE_W) {
        // Fold in priority order within one pass — the state snapshot `s`
        // goes stale the moment a setter fires, so track openness locally.
        if (rightOpen) {
          rightOpen = false;
          flags.right = true;
          setRightSidebarCollapsed(true);
        }
        if (leftOpen && space(leftOpen, rightOpen) < COLLAPSE_W) {
          flags.left = true;
          setLeftSidebarCollapsed(true);
        }
      } else {
        if (flags.left && space(true, rightOpen) >= RESTORE_W) {
          flags.left = false;
          setLeftSidebarCollapsed(false);
          leftOpen = true;
        }
        if (flags.right && space(leftOpen, true) >= RESTORE_W) {
          flags.right = false;
          setRightSidebarCollapsed(false);
        }
      }

      // Vertical: a short window can't afford the bottom panel either.
      if (vh < COLLAPSE_H) {
        if (!s.bottomPanelCollapsed) {
          flags.bottom = true;
          setBottomPanelCollapsed(true);
        }
      } else if (vh >= RESTORE_H && flags.bottom) {
        flags.bottom = false;
        setBottomPanelCollapsed(false);
      }

      markAutoHidden(flags);
    };

    evaluate();
    window.addEventListener('resize', evaluate);
    return () => window.removeEventListener('resize', evaluate);
  }, []);

  // User-facing collapse setters: taking manual control of a panel retires
  // any pending auto-restore for it, so the automation never fights the user.
  const collapseLeft = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((action) => {
    if (autoHidden.current.left) markAutoHidden({ ...autoHidden.current, left: false });
    setLeftSidebarCollapsed(action);
  }, []);
  const collapseRight = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((action) => {
    if (autoHidden.current.right) markAutoHidden({ ...autoHidden.current, right: false });
    setRightSidebarCollapsed(action);
  }, []);
  const collapseBottom = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((action) => {
    if (autoHidden.current.bottom) markAutoHidden({ ...autoHidden.current, bottom: false });
    setBottomPanelCollapsed(action);
  }, []);

  // View mode — details list is the Wisp default
  const [viewMode, setViewMode] = useState<string>(() => loadUiState('viewMode', 'details'));

  // Sorting — global. The same `wisp:ui-state` fields drive the per-pane
  // folder settings; the event tells every open pane to re-sort immediately.
  const [sortBy, setSortByRaw] = useState<SortField>(() =>
    loadUiState<SortField>('sortBy', 'dateModified'),
  );
  const [sortOrder, setSortOrderRaw] = useState<'asc' | 'desc'>(() =>
    loadUiState('sortOrder', 'desc'),
  );

  const notifySortChanged = useCallback(
    (detail: { sortBy: SortField; sortOrder: 'asc' | 'desc' }) => {
      window.dispatchEvent(new CustomEvent('wisp-sort-changed', { detail }));
    },
    [],
  );

  // Refs so the setter wrappers can read the latest counterpart value
  const sortByRef = useRef(sortBy);
  sortByRef.current = sortBy;
  const sortOrderRef = useRef(sortOrder);
  sortOrderRef.current = sortOrder;

  const setSortBy: React.Dispatch<React.SetStateAction<SortField>> = useCallback(
    (action) => {
      setSortByRaw((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        if (next !== prev) notifySortChanged({ sortBy: next, sortOrder: sortOrderRef.current });
        return next;
      });
    },
    [notifySortChanged],
  );

  const setSortOrder: React.Dispatch<React.SetStateAction<'asc' | 'desc'>> = useCallback(
    (action) => {
      setSortOrderRaw((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        if (next !== prev) notifySortChanged({ sortBy: sortByRef.current, sortOrder: next });
        return next;
      });
    },
    [notifySortChanged],
  );

  // Follow global sort changes made elsewhere (per-pane sort dropdowns write
  // the shared store directly); keeps this state — and the debounced
  // ui-state persistence that reads it — from clobbering the global choice.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sortBy?: SortField; sortOrder?: 'asc' | 'desc' }>).detail;
      if (detail?.sortBy) setSortByRaw(detail.sortBy);
      if (detail?.sortOrder) setSortOrderRaw(detail.sortOrder);
    };
    window.addEventListener('wisp-sort-changed', handler);
    return () => window.removeEventListener('wisp-sort-changed', handler);
  }, []);

  return {
    leftSidebarCollapsed,
    setLeftSidebarCollapsed: collapseLeft,
    rightSidebarCollapsed,
    setRightSidebarCollapsed: collapseRight,
    bottomPanelCollapsed,
    setBottomPanelCollapsed: collapseBottom,
    leftSidebarWidth,
    setLeftSidebarWidth,
    rightSidebarWidth,
    setRightSidebarWidth,
    bottomPanelHeight,
    setBottomPanelHeight,
    handleLeftResize,
    handleRightResize,
    handleBottomResize,
    rightPanelTab,
    setRightPanelTab,
    bottomPanelTab,
    setBottomPanelTab,
    searchPanelOpen,
    setSearchPanelOpen,
    viewMode,
    setViewMode,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
  };
};
