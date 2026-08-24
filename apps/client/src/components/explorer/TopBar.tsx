import React, { useRef, useState, useEffect, forwardRef } from 'react';
import { isTauri } from '@/lib/transport';
import {
  Minus,
  Square,
  Copy,
  X,
  Plus,
  Columns,
  Rows,
  ChevronUp,
  RefreshCw,
  MessageSquare,
  Search,
} from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { ROOT_PATH } from '@/lib/constants';
import type { TabItem } from '@/types/split-view';
import { getTabIcon } from '@/lib/tab-utils';
import { useTranslation } from 'react-i18next';
import wispLogo from '../../../../src-tauri/icons/icon.png';

export interface TopBarHandle {
  // Retained for API compatibility — search now lives in the sidebar
}
interface TopBarProps {
  leftSidebarCollapsed: boolean;
  setLeftSidebarCollapsed: (collapsed: boolean) => void;
  currentPath: string;
  // Navigation
  navigateUp?: () => void;
  refetch?: () => void;
  navigateBackInHistory?: () => void;
  navigateForwardInHistory?: () => void;
  canNavigateBackInHistory?: () => boolean;
  canNavigateForwardInHistory?: () => boolean;
  // Tabs
  tabs?: TabItem[];
  activeTabId?: string;
  onSwitchTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  // Split/tab actions
  onAddTab?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  'data-tour'?: string;
  // Cross-tab selection
  crossTabTotalCount?: number;
  crossTabTabCount?: number;
  hasMultiTabSelection?: boolean;
  onOpenBatchActions?: () => void;
  onClearCrossTabSelection?: () => void;
}

const TopBar = React.memo(
  forwardRef<TopBarHandle, TopBarProps>(
    (
      {
        leftSidebarCollapsed,
        setLeftSidebarCollapsed,
        currentPath,
        navigateUp,
        refetch,
        navigateBackInHistory,
        navigateForwardInHistory,
        canNavigateBackInHistory,
        canNavigateForwardInHistory,
        tabs,
        activeTabId,
        onSwitchTab,
        onCloseTab,
        onAddTab,
        onSplitRight,
        onSplitDown,
        'data-tour': dataTour,
        crossTabTotalCount = 0,
        crossTabTabCount = 0,
        hasMultiTabSelection = false,
        onOpenBatchActions,
        onClearCrossTabSelection,
      },
      _ref,
    ) => {
      const { t } = useTranslation();
      const [isMaximized, setIsMaximized] = useState(false);
      const appWindowRef = useRef<Awaited<
        ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>
      > | null>(null);
      const isMac = navigator.platform.toUpperCase().includes('MAC');

      useEffect(() => {
        if (!isTauri()) return;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;
        const cleanupRef = { current: null as (() => void) | null };
        (async () => {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const win = getCurrentWindow();
          if (cancelled) return;
          appWindowRef.current = win;
          win
            .isMaximized()
            .then(setIsMaximized)
            .catch((err: unknown) => console.warn('Failed to check maximized state:', err));
          const unlisten = win.onResized(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              win
                .isMaximized()
                .then(setIsMaximized)
                .catch((err: unknown) => console.warn('Failed to check maximized state:', err));
            }, 150);
          });
          // Store unlisten for cleanup
          if (!cancelled) {
            cleanupRef.current = async () => {
              if (debounceTimer) clearTimeout(debounceTimer);
              (await unlisten)();
            };
          }
        })();
        return () => {
          cancelled = true;
          if (debounceTimer) clearTimeout(debounceTimer);
          cleanupRef.current?.();
        };
      }, []);

      return (
        <div
          data-tour={dataTour}
          className="wisp-titlebar wisp-no-select flex-none border-b border-xp-border bg-xp-surface backdrop-blur-xl"
        >
          {/* Row 1: Title bar (draggable) */}
          <div
            className="relative flex h-11 items-center justify-between px-3"
            onMouseDown={(e) => {
              if (
                !(e.target as HTMLElement).closest(
                  'button, input, a, select, textarea, [role="button"]',
                )
              ) {
                e.preventDefault();
                appWindowRef.current?.startDragging();
              }
            }}
            onDoubleClick={(e) => {
              if (
                !(e.target as HTMLElement).closest(
                  'button, input, a, select, textarea, [role="button"]',
                )
              ) {
                appWindowRef.current?.toggleMaximize();
              }
            }}
          >
            <div className="flex items-center" style={isMac ? { paddingLeft: '60px' } : undefined}>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                  aria-label={t('topBar.toggleSidebar')}
                  title={t('topBar.toggleSidebarShortcut')}
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                <div className="flex items-center gap-2">
                  <img src={wispLogo} alt="" className="h-6 w-6 rounded-[7px]" aria-hidden="true" />
                  <h1 className="text-sm font-semibold tracking-tight">Wisp</h1>
                </div>
              </div>
            </div>

            {/* One global entry point for files, commands, and actions. */}
            <button
              type="button"
              data-command-palette-trigger
              onClick={() => window.dispatchEvent(new CustomEvent('wisp-open-command-palette'))}
              className="absolute left-1/2 hidden h-8 w-[min(38vw,420px)] -translate-x-1/2 items-center gap-2 rounded-lg border border-xp-border bg-muted px-3 text-left text-xs text-xp-text-muted shadow-sm transition-all hover:border-primary hover:bg-xp-surface-light hover:text-xp-text min-[820px]:flex"
              aria-label={t('commandPalette.trigger')}
              title={t('commandPalette.trigger')}
            >
              <Search size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t('commandPalette.trigger')}</span>
              <kbd className="rounded border border-xp-border bg-xp-surface px-1.5 py-0.5 font-sans text-[10px] text-xp-text-secondary">
                {isMac ? '⌘⇧P' : 'Ctrl⇧P'}
              </kbd>
            </button>

            <div className="flex-1" />
            {!isMac && (
              <div className="ml-2 flex items-center" role="toolbar" aria-label="Window controls">
                <button
                  onClick={() => appWindowRef.current?.minimize()}
                  className="rounded p-2 transition-colors hover:bg-xp-surface-light"
                  aria-label={t('topBar.minimize')}
                >
                  <Minus size={14} />
                </button>
                <button
                  onClick={() => appWindowRef.current?.toggleMaximize()}
                  className="rounded p-2 transition-colors hover:bg-xp-surface-light"
                  aria-label={isMaximized ? t('topBar.restore') : t('topBar.maximize')}
                >
                  {isMaximized ? <Copy size={14} /> : <Square size={14} />}
                </button>
                <button
                  onClick={() => appWindowRef.current?.close()}
                  className="xp-close-btn rounded p-2 transition-colors"
                  aria-label={t('topBar.closeWindow')}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Row 2: Nav buttons + Tabs + Split controls */}
          <div className="flex min-h-9 items-center gap-0.5 px-2">
            {/* Nav buttons */}
            {navigateBackInHistory && (
              <button
                onClick={navigateBackInHistory}
                disabled={!canNavigateBackInHistory?.()}
                className="flex-shrink-0 rounded p-1 transition-colors hover:bg-xp-surface-light disabled:opacity-30"
                title={t('topBar.goBack')}
                aria-label={t('topBar.goBack')}
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
            {navigateForwardInHistory && (
              <button
                onClick={navigateForwardInHistory}
                disabled={!canNavigateForwardInHistory?.()}
                className="flex-shrink-0 rounded p-1 transition-colors hover:bg-xp-surface-light disabled:opacity-30"
                title={t('topBar.goForward')}
                aria-label={t('topBar.goForward')}
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
            {navigateUp && (
              <button
                onClick={navigateUp}
                disabled={currentPath === ROOT_PATH}
                className="flex-shrink-0 rounded p-1 transition-colors hover:bg-xp-surface-light disabled:opacity-30"
                title={t('topBar.goUp')}
                aria-label={t('topBar.goUp')}
              >
                <ChevronUp size={16} />
              </button>
            )}
            {refetch && (
              <button
                onClick={refetch}
                className="flex-shrink-0 rounded p-1 transition-colors hover:bg-xp-surface-light"
                title={t('topBar.refresh')}
                aria-label={t('topBar.refresh')}
              >
                <RefreshCw size={14} />
              </button>
            )}

            {/* New Chat button — available in any folder */}
            {!currentPath.startsWith('wisp://') && (
              <button
                onClick={async () => {
                  try {
                    await TauriAPI.createChatFile(currentPath);
                    refetch?.();
                  } catch (err) {
                    console.error('Failed to create chat:', err);
                  }
                }}
                className="flex-shrink-0 rounded p-1 transition-colors hover:bg-xp-surface-light"
                title={t('topBar.newChatDesc')}
                aria-label={t('topBar.newChat')}
              >
                <MessageSquare size={14} />
              </button>
            )}

            {/* Separator */}
            <div className="mx-0.5 h-5 w-px flex-shrink-0 bg-xp-border" />

            {/* Tabs */}
            <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto">
              {tabs?.map((tab) => {
                const TabIcon = getTabIcon(tab);
                const isActive = activeTabId === tab.id;
                return (
                  <div
                    key={tab.id}
                    className={`group flex min-w-0 max-w-[180px] flex-shrink-0 cursor-pointer items-center border-r border-xp-border px-3 py-1 ${
                      isActive
                        ? 'border-b-2 border-b-xp-blue bg-xp-bg'
                        : 'hover:bg-xp-surface-light'
                    }`}
                    onClick={() => onSwitchTab?.(tab.id)}
                  >
                    <TabIcon size={13} className="mr-1.5 flex-shrink-0 text-xp-text-secondary" />
                    <span className="truncate text-xs font-medium">{tab.name}</span>
                    {tabs.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseTab?.(tab.id);
                        }}
                        className="ml-1 flex-shrink-0 rounded p-0.5 opacity-0 hover:bg-xp-surface-light group-hover:opacity-100"
                        aria-label={`Close ${tab.name}`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Split/tab actions */}
            <div className="ml-0.5 flex flex-shrink-0 items-center gap-0.5">
              {onAddTab && (
                <button
                  onClick={onAddTab}
                  className="rounded p-1 text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('topBar.newTabShortcut')}
                  aria-label={t('topBar.newTab')}
                >
                  <Plus size={14} />
                </button>
              )}
              {onSplitRight && (
                <button
                  onClick={onSplitRight}
                  className="rounded p-1 text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('topBar.splitRightShortcut')}
                  aria-label={t('topBar.splitRight')}
                >
                  <Columns size={14} />
                </button>
              )}
              {onSplitDown && (
                <button
                  onClick={onSplitDown}
                  className="rounded p-1 text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('topBar.splitDownShortcut')}
                  aria-label={t('topBar.splitDown')}
                >
                  <Rows size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Cross-tab selection floating action bar */}
          {hasMultiTabSelection && crossTabTotalCount > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 12px',
                background: 'color-mix(in srgb, var(--xp-blue) 12%, var(--xp-surface))',
                borderTop: '1px solid color-mix(in srgb, var(--xp-blue) 25%, var(--xp-border))',
                fontSize: 12,
                color: 'var(--xp-text)',
              }}
            >
              {/* Selection badge */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'var(--xp-blue)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                {crossTabTotalCount !== 1 || crossTabTabCount !== 1
                  ? t('topBar.crossTabSelectionPlural', {
                      fileCount: crossTabTotalCount,
                      tabCount: crossTabTabCount,
                    })
                  : t('topBar.crossTabSelection', {
                      fileCount: crossTabTotalCount,
                      tabCount: crossTabTabCount,
                    })}
              </span>

              <span style={{ color: 'var(--xp-text-muted)', fontSize: 11 }}>
                {t('topBar.crossTabHint')}
              </span>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Batch Actions button */}
              {onOpenBatchActions && (
                <button
                  onClick={onOpenBatchActions}
                  style={{
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: 5,
                    border: '1px solid var(--xp-blue)',
                    background: 'var(--xp-blue)',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'opacity 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.opacity = '0.85';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.opacity = '1';
                  }}
                  title={t('topBar.batchActionsDesc')}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                  {t('topBar.batchActions')}
                </button>
              )}

              {/* Clear Selection button */}
              {onClearCrossTabSelection && (
                <button
                  onClick={onClearCrossTabSelection}
                  style={{
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: 5,
                    border: '1px solid var(--xp-border)',
                    background: 'var(--xp-surface-light)',
                    color: 'var(--xp-text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--xp-surface)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--xp-text)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--xp-surface-light)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--xp-text-muted)';
                  }}
                  title={t('topBar.clearSelectionDesc')}
                >
                  <X size={12} />
                  {t('topBar.clearSelection')}
                </button>
              )}
            </div>
          )}
        </div>
      );
    },
  ),
);
TopBar.displayName = 'TopBar';
export default TopBar;
