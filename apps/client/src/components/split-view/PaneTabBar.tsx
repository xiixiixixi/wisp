import React, { useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, X, Columns, Rows, Pin, Maximize2, Minimize2, Link, Unlink } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { TabItem } from '@/types/split-view';
import type { CrossTabSelection } from '@/hooks/use-cross-tab-selection';
import { useCrossTabSelectionContext } from '@/contexts/CrossTabSelectionContext';
import { getTabIcon } from '@/lib/tab-utils';
import type { PaneSyncMode } from '@/hooks/use-pane-sync';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu';
import '@/styles/pane-tabs.css';

interface PaneTabBarProps {
  groupId: string;
  tabs: TabItem[];
  activeTabId: string;
  isActiveGroup: boolean;
  canClose: boolean;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onCloseGroup: () => void;
  onFocus: () => void;
  onTogglePin?: (tabId: string) => void;
  onDuplicateTab?: (tabId: string) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onCloseTabsToRight?: (tabId: string) => void;
  onCloseAllTabs?: () => void;
  onReorderTab?: (fromIndex: number, toIndex: number) => void;
  /** Whether this pane is currently maximized */
  isMaximized?: boolean;
  onMaximizePane?: () => void;
  onRestorePane?: () => void;
  /** Cross-tab selection data — used for badge indicators and drop targets */
  crossTabSelections?: Map<string, CrossTabSelection>;
  /** Called when files are dropped onto a tab header */
  onCrossTabDrop?: (targetTabPath: string, sourceFiles: { path: string; name: string }[]) => void;
  /** Pane sync navigation state */
  paneSyncEnabled?: boolean;
  paneSyncMode?: PaneSyncMode;
  onTogglePaneSync?: () => void;
  onSwitchPaneSyncMode?: (mode: PaneSyncMode) => void;
  /** Whether there are multiple panes (sync button only shows when true) */
  hasMultiplePanes?: boolean;
}

// ── Context Menu ──────────────────────────────────────────────────────────────

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

const TabContextMenu = ({
  menu,
  tab,
  tabs,
  onClose,
  onTogglePin,
  onDuplicateTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseAllTabs,
  onMoveTab,
  canMoveLeft,
  canMoveRight,
}: {
  menu: ContextMenuState;
  tab: TabItem;
  tabs: TabItem[];
  onClose: () => void;
  onTogglePin?: (tabId: string) => void;
  onDuplicateTab?: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onCloseTabsToRight?: (tabId: string) => void;
  onCloseAllTabs?: () => void;
  onMoveTab?: (direction: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}) => {
  const { t } = useTranslation();
  const tabIndex = tabs.findIndex((item) => item.id === tab.id);
  const hasTabsToRight = tabs.slice(tabIndex + 1).some((item) => !item.isPinned);
  const hasOtherTabs = tabs.some((item) => item.id !== tab.id && !item.isPinned);
  const items: ContextMenuItem[] = [
    {
      id: 'pin',
      label: tab.isPinned ? t('splitView.unpinTab') : t('splitView.pinTab'),
      action: () => onTogglePin?.(tab.id),
      disabled: !onTogglePin,
    },
    {
      id: 'duplicate',
      label: t('splitView.duplicateTab'),
      action: () => onDuplicateTab?.(tab.id),
      disabled: !onDuplicateTab,
    },
    ...(onMoveTab
      ? [
          {
            id: 'move-left',
            label: t('splitView.moveTabLeft', { defaultValue: 'Move Tab Left' }),
            action: () => onMoveTab(-1),
            disabled: !canMoveLeft,
          },
          {
            id: 'move-right',
            label: t('splitView.moveTabRight', { defaultValue: 'Move Tab Right' }),
            action: () => onMoveTab(1),
            disabled: !canMoveRight,
          },
        ]
      : []),
    { id: 'before-close', label: '', separator: true },
    {
      id: 'close',
      label: t('splitView.closeTab'),
      action: () => onCloseTab(tab.id),
      disabled: !!tab.isPinned,
    },
    {
      id: 'close-other',
      label: t('splitView.closeOtherTabs'),
      action: () => onCloseOtherTabs?.(tab.id),
      disabled: !hasOtherTabs || !onCloseOtherTabs,
    },
    {
      id: 'close-right',
      label: t('splitView.closeTabsToRight'),
      action: () => onCloseTabsToRight?.(tab.id),
      disabled: !hasTabsToRight || !onCloseTabsToRight,
    },
    {
      id: 'close-all',
      label: t('splitView.closeAllTabs'),
      action: onCloseAllTabs,
      disabled: !onCloseAllTabs,
    },
  ];
  return createPortal(
    <ContextMenu isOpen x={menu.x} y={menu.y} onClose={onClose} items={items} />,
    document.body,
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const PaneTabBar = ({
  groupId: _groupId,
  tabs,
  activeTabId,
  isActiveGroup: _isActiveGroup,
  canClose,
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onSplitHorizontal,
  onSplitVertical,
  onCloseGroup,
  onFocus,
  onTogglePin,
  onDuplicateTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseAllTabs,
  onReorderTab,
  isMaximized,
  onMaximizePane,
  onRestorePane,
  crossTabSelections,
  onCrossTabDrop,
  paneSyncEnabled,
  paneSyncMode,
  onTogglePaneSync,
  onSwitchPaneSyncMode,
  hasMultiplePanes,
}: PaneTabBarProps) => {
  const { t } = useTranslation();

  // Maximize/restore toggle
  const handleToggleMaximize = useCallback(() => {
    if (isMaximized) {
      onRestorePane?.();
    } else {
      onMaximizePane?.();
    }
  }, [isMaximized, onMaximizePane, onRestorePane]);

  // Cross-tab selection: prefer prop, fallback to context
  const ctxCrossTab = useCrossTabSelectionContext();
  const effectiveCrossTabSelections = useMemo(
    () => crossTabSelections ?? ctxCrossTab?.selections ?? new Map<string, CrossTabSelection>(),
    [crossTabSelections, ctxCrossTab?.selections],
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Drag-to-reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Cross-tab file drop state: which tab is being hovered with external files
  const [crossTabDropTarget, setCrossTabDropTarget] = useState<string | null>(null);

  // Check if a tab has a cross-tab selection (by matching tab path)
  const tabHasCrossTabSelection = useCallback(
    (tab: TabItem) => {
      if (!effectiveCrossTabSelections || effectiveCrossTabSelections.size === 0) return false;
      for (const sel of effectiveCrossTabSelections.values()) {
        if (sel.tabPath === tab.path && sel.files.length > 0) return true;
      }
      return false;
    },
    [effectiveCrossTabSelections],
  );

  // Cross-tab file drop handlers for individual tab headers
  const handleCrossTabDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    // Only react if we have cross-tab data in the drag
    if (e.dataTransfer.types.includes('application/x-wisp-cross-tab-files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setCrossTabDropTarget(tabId);
    }
  }, []);

  const handleCrossTabDragLeave = useCallback((_e: React.DragEvent, tabId: string) => {
    setCrossTabDropTarget((prev) => (prev === tabId ? null : prev));
  }, []);

  const handleCrossTabFileDrop = useCallback(
    (e: React.DragEvent, tab: TabItem) => {
      setCrossTabDropTarget(null);
      const raw = e.dataTransfer.getData('application/x-wisp-cross-tab-files');
      if (!raw) return;
      try {
        const files = JSON.parse(raw) as { path: string; name: string }[];
        if (files.length > 0 && onCrossTabDrop) {
          onCrossTabDrop(tab.path, files);
        }
      } catch {
        /* ignore bad data */
      }
    },
    [onCrossTabDrop],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Sort tabs: pinned first, then unpinned (preserving relative order within each group)
  const sortedTabs = React.useMemo(() => {
    const pinned = tabs.filter((t) => t.isPinned);
    const unpinned = tabs.filter((t) => !t.isPinned);
    return [...pinned, ...unpinned];
  }, [tabs]);

  const pinnedCount = sortedTabs.filter((t) => t.isPinned).length;

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // Make the drag ghost semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragIndex === null) return;

      // Enforce pinned/unpinned boundary:
      // A pinned tab can only be dropped among pinned tabs (0..pinnedCount-1)
      // An unpinned tab can only be dropped among unpinned tabs (pinnedCount..end)
      const isDraggingPinned = sortedTabs[dragIndex]?.isPinned;
      if (isDraggingPinned && index >= pinnedCount) return;
      if (!isDraggingPinned && index < pinnedCount) return;

      setDropIndex(index);
    },
    [dragIndex, pinnedCount, sortedTabs],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === toIndex) {
        setDragIndex(null);
        setDropIndex(null);
        return;
      }

      // Enforce boundary
      const isDraggingPinned = sortedTabs[dragIndex]?.isPinned;
      if (isDraggingPinned && toIndex >= pinnedCount) return;
      if (!isDraggingPinned && toIndex < pinnedCount) return;

      // Map sorted indices back to original tab array indices
      const fromTab = sortedTabs[dragIndex];
      const toTab = sortedTabs[toIndex];
      const origFrom = tabs.findIndex((t) => t.id === fromTab.id);
      const origTo = tabs.findIndex((t) => t.id === toTab.id);

      if (origFrom >= 0 && origTo >= 0) {
        onReorderTab?.(origFrom, origTo);
      }

      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex, pinnedCount, sortedTabs, tabs, onReorderTab],
  );

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({ tabId: sortedTabs[index].id, x: rect.left, y: rect.bottom + 4 });
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % sortedTabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + sortedTabs.length) % sortedTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sortedTabs.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    onSwitchTab(sortedTabs[next].id);
    tabRefs.current[next]?.focus();
  };

  const switchSyncMode = () => {
    if (!onSwitchPaneSyncMode) return;
    const next = paneSyncMode === 'mirror' ? 'relative' : 'mirror';
    onSwitchPaneSyncMode(next);
    toast({
      title:
        next === 'mirror'
          ? t('splitView.syncSwitchedToMirror')
          : t('splitView.syncSwitchedToRelative'),
    });
  };
  const syncTitle = paneSyncEnabled
    ? t('splitView.syncNavOnTitle', {
        mode:
          paneSyncMode === 'mirror'
            ? t('splitView.syncModeMirror')
            : t('splitView.syncModeRelative'),
      })
    : t('splitView.syncNavOffTitle');
  const ctxTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) : undefined;
  const ctxIndex = ctxTab ? sortedTabs.findIndex((tab) => tab.id === ctxTab.id) : -1;
  const canMove = (direction: -1 | 1) => {
    const neighbour = sortedTabs[ctxIndex + direction];
    return !!ctxTab && !!neighbour && !!neighbour.isPinned === !!ctxTab.isPinned;
  };
  const moveContextTab = (direction: -1 | 1) => {
    if (!ctxTab || !canMove(direction)) return;
    const target = sortedTabs[ctxIndex + direction];
    onReorderTab?.(
      tabs.findIndex((tab) => tab.id === ctxTab.id),
      tabs.findIndex((tab) => tab.id === target.id),
    );
  };

  return (
    <div
      className="wisp-pane-tabbar"
      onMouseDown={onFocus}
      onFocus={onFocus}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button, [data-tab-item]')) return;
        handleToggleMaximize();
      }}
    >
      <div
        className="wisp-pane-tab-list"
        role="tablist"
        aria-label={t('splitView.tabList', { defaultValue: 'Pane tabs' })}
      >
        {sortedTabs.map((tab, index) => {
          const TabIcon = getTabIcon(tab);
          const label =
            tab.path === 'wisp://home' ? t('navigation.home', { defaultValue: 'Home' }) : tab.name;
          const isActive = activeTabId === tab.id;
          const isPinned = !!tab.isPinned;
          const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;
          const hasCrossSelection = tabHasCrossTabSelection(tab);
          return (
            <div
              key={tab.id}
              className="wisp-pane-tab"
              role="presentation"
              data-tab-item
              data-active={isActive || undefined}
              data-pinned={isPinned || undefined}
              data-dragging={dragIndex === index || undefined}
              data-cross-drop={crossTabDropTarget === tab.id || undefined}
              data-drop-target={
                tab.type === 'folder' && tab.path && !tab.path.startsWith('wisp://')
                  ? tab.path
                  : undefined
              }
              data-is-folder={
                tab.type === 'folder' && tab.path && !tab.path.startsWith('wisp://')
                  ? 'true'
                  : undefined
              }
              draggable
              onDragStart={(event) => handleDragStart(event, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(event) => {
                handleDragOver(event, index);
                handleCrossTabDragOver(event, tab.id);
              }}
              onDragLeave={(event) => handleCrossTabDragLeave(event, tab.id)}
              onDrop={(event) => {
                handleDrop(event, index);
                handleCrossTabFileDrop(event, tab);
              }}
              onContextMenu={(event) => handleContextMenu(event, tab.id)}
            >
              {isDropTarget && dragIndex !== null && (
                <span
                  className="wisp-pane-tab-drop-marker"
                  data-edge={dragIndex > index ? 'left' : 'right'}
                  aria-hidden="true"
                />
              )}
              <button
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                className="wisp-pane-tab-button"
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={label}
                aria-haspopup="menu"
                tabIndex={
                  isActive || (!sortedTabs.some((item) => item.id === activeTabId) && index === 0)
                    ? 0
                    : -1
                }
                title={tab.path === 'wisp://home' ? label : tab.path}
                onClick={() => onSwitchTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {isPinned && <Pin className="wisp-pane-tab-pin" size={10} aria-hidden="true" />}
                <TabIcon className="wisp-pane-tab-icon" size={14} aria-hidden="true" />
                <span className="wisp-pane-tab-label">{label}</span>
                {hasCrossSelection && (
                  <span
                    className="wisp-pane-tab-badge"
                    title={t('splitView.crossTabBadgeTitle')}
                    aria-hidden="true"
                  />
                )}
              </button>
              {!isPinned && tabs.length > 1 && (
                <button
                  className="wisp-pane-tab-close"
                  type="button"
                  tabIndex={isActive ? 0 : -1}
                  aria-label={t('splitView.closeNamedTab', {
                    name: label,
                    defaultValue: 'Close {{name}}',
                  })}
                  onClick={() => onCloseTab(tab.id)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="wisp-pane-tab-actions">
        <button
          type="button"
          className="wisp-pane-tab-action"
          onClick={onAddTab}
          title={t('splitView.newTab')}
          aria-label={t('splitView.newTab')}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
        {hasMultiplePanes && onTogglePaneSync && (
          <button
            type="button"
            className="wisp-pane-tab-action wisp-pane-tab-sync"
            onClick={onTogglePaneSync}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              switchSyncMode();
            }}
            onKeyDown={(event) => {
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                event.stopPropagation();
                switchSyncMode();
              }
            }}
            aria-pressed={!!paneSyncEnabled}
            aria-label={syncTitle}
            title={syncTitle}
          >
            {paneSyncEnabled ? (
              <Link size={14} aria-hidden="true" />
            ) : (
              <Unlink size={14} aria-hidden="true" />
            )}
            {paneSyncEnabled && (
              <span className="wisp-pane-tab-sync-mode">
                {paneSyncMode === 'mirror'
                  ? t('splitView.syncModeMirrorShort')
                  : t('splitView.syncModeRelativeShort')}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          className="wisp-pane-tab-action"
          onClick={onSplitHorizontal}
          title={t('splitView.splitRight')}
          aria-label={t('splitView.splitRight')}
        >
          <Columns size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="wisp-pane-tab-action"
          onClick={onSplitVertical}
          title={t('splitView.splitDown')}
          aria-label={t('splitView.splitDown')}
        >
          <Rows size={15} aria-hidden="true" />
        </button>
        {canClose && (
          <>
            <button
              type="button"
              className="wisp-pane-tab-action"
              onClick={handleToggleMaximize}
              aria-pressed={!!isMaximized}
              title={isMaximized ? t('splitView.restorePane') : t('splitView.maximizePane')}
              aria-label={isMaximized ? t('splitView.restorePane') : t('splitView.maximizePane')}
            >
              {isMaximized ? (
                <Minimize2 size={14} aria-hidden="true" />
              ) : (
                <Maximize2 size={14} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="wisp-pane-tab-action wisp-pane-tab-action-close"
              onClick={onCloseGroup}
              title={t('splitView.closePane')}
              aria-label={t('splitView.closePane')}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {contextMenu && ctxTab && (
        <TabContextMenu
          menu={contextMenu}
          tab={ctxTab}
          tabs={tabs}
          onClose={closeContextMenu}
          onTogglePin={onTogglePin}
          onDuplicateTab={onDuplicateTab}
          onCloseTab={onCloseTab}
          onCloseOtherTabs={onCloseOtherTabs}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseAllTabs={onCloseAllTabs}
          onMoveTab={onReorderTab ? moveContextTab : undefined}
          canMoveLeft={canMove(-1)}
          canMoveRight={canMove(1)}
        />
      )}
    </div>
  );
};

export default PaneTabBar;
