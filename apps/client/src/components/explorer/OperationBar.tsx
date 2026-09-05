import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Rows3,
  BarChart3,
  FolderPlus,
  Package,
  PackageOpen,
  Info,
  Terminal,
  Copy,
  Scissors,
  Clipboard,
  Eye,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SortField } from '@/lib/utils';

interface ViewMode {
  id: string;
  name: string;
  icon: React.ReactNode;
}

interface SortOption {
  id: SortField;
  name: string;
  icon: React.ReactNode;
}

type OperationMenu = 'sort' | 'view';

interface OperationBarProps {
  viewMode: string;
  setViewMode: (mode: string) => void;
  viewModes: Record<string, ViewMode>;
  sortBy: SortField;
  setSortBy: (sortBy: SortField) => void;
  sortOrder: 'asc' | 'desc';
  toggleSortOrder: () => void;
  sortOptions: Record<SortField, SortOption>;
  groupByDate?: boolean;
  setGroupByDate?: (enabled: boolean) => void;
  handleCreateFolder: () => void;
  handleDelete: () => void;
  selectedFiles: Set<string>;
  setBottomPanelCollapsed: (collapsed: boolean) => void;
  setBottomPanelTab: (tab: 'terminal' | 'output' | 'git' | string) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  onInvertSelection?: () => void;
  onAdvancedSelection?: () => void;
  /** Whether size heatmap badges are shown */
  showSizeBadges?: boolean;
  /** Toggle size heatmap badges */
  onToggleSizeBadges?: () => void;
  /** Whether the current view mode was auto-detected */
  isAutoDetected?: boolean;
  /** Callback to clear the auto-detected view and re-trigger detection */
  onClearAutoDetect?: () => void;
  /** Optional action callbacks for the gear menu */
  onCompress?: () => void;
  onExtract?: () => void;
  onProperties?: () => void;
  /** Current directory path (used for Open in Terminal fallback) */
  currentPath?: string;
  /** Clipboard actions */
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  hasClipboard?: boolean;
  onPreview?: () => void;
  statusAccessory?: React.ReactNode;
}

const OperationBar = ({
  viewMode,
  setViewMode,
  viewModes,
  sortBy,
  setSortBy,
  sortOrder,
  toggleSortOrder,
  sortOptions,
  groupByDate,
  setGroupByDate,
  handleCreateFolder,
  handleDelete,
  selectedFiles,
  setBottomPanelCollapsed,
  setBottomPanelTab,
  onSelectAll: _onSelectAll,
  onSelectNone,
  onInvertSelection: _onInvertSelection,
  onAdvancedSelection: _onAdvancedSelection,
  showSizeBadges,
  onToggleSizeBadges,
  isAutoDetected: _isAutoDetected,
  onClearAutoDetect: _onClearAutoDetect,
  onCompress,
  onExtract,
  onProperties,
  currentPath: _currentPath,
  onCopy,
  onCut,
  onPaste,
  hasClipboard,
  onPreview,
  statusAccessory,
}: OperationBarProps) => {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<OperationMenu | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  const triggerFor = (menu: OperationMenu) =>
    menu === 'sort' ? sortTriggerRef.current : viewTriggerRef.current;

  const menuFor = (menu: OperationMenu) =>
    menu === 'sort' ? sortMenuRef.current : viewMenuRef.current;

  const closeMenu = (restoreFocus = false) => {
    const menu = openMenu;
    setOpenMenu(null);
    if (restoreFocus && menu) requestAnimationFrame(() => triggerFor(menu)?.focus());
  };

  const menuItems = (menu: OperationMenu) =>
    Array.from(
      menuFor(menu)?.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
      ) ?? [],
    );

  const focusMenuItem = (menu: OperationMenu, position: 'first' | 'last' | 'next' | 'previous') => {
    const items = menuItems(menu);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex = 0;
    if (position === 'last') nextIndex = items.length - 1;
    if (position === 'next') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (position === 'previous') {
      nextIndex =
        currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    }
    items[nextIndex]?.focus();
  };

  const handleMenuTriggerKeyDown = (
    menu: OperationMenu,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpenMenu(menu);
    requestAnimationFrame(() => focusMenuItem(menu, event.key === 'ArrowUp' ? 'last' : 'first'));
  };

  const handleMenuKeyDown = (menu: OperationMenu, event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusMenuItem(menu, 'next');
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusMenuItem(menu, 'previous');
        break;
      case 'Home':
        event.preventDefault();
        focusMenuItem(menu, 'first');
        break;
      case 'End':
        event.preventDefault();
        focusMenuItem(menu, 'last');
        break;
      case 'Escape':
        event.preventDefault();
        closeMenu(true);
        break;
    }
  };

  useEffect(() => {
    if (!openMenu) return;
    // Capture phase: pane/drag handlers that stopPropagation on mousedown
    // would otherwise swallow the event before it reaches this listener.
    // The click fallback also covers synthetic accessibility presses that
    // never dispatch pointer events.
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const menu = openMenu;
        setOpenMenu(null);
        requestAnimationFrame(() => {
          if (menu === 'sort') sortTriggerRef.current?.focus();
          else viewTriggerRef.current?.focus();
        });
      }
    };
    const onClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [openMenu]);

  const getSortLabel = (id: SortField) =>
    t(`operationBar.sortOptions.${id}`, {
      defaultValue: sortOptions?.[id]?.name || t('operationBar.sortOptions.name'),
    });
  const getViewLabel = (id: string) =>
    t(`operationBar.viewModes.${id}`, {
      defaultValue: viewModes[id]?.name || t('operationBar.viewModes.medium'),
    });
  const currentSortLabel = getSortLabel(sortBy);
  const currentViewLabel = getViewLabel(viewMode);
  const currentSortOrder = t(
    sortOrder === 'asc' ? 'operationBar.ascending' : 'operationBar.descending',
  );

  if (selectedFiles.size > 0) {
    return (
      <div
        ref={barRef}
        className="wisp-operationbar border-b border-xp-blue/30 bg-xp-blue/5 px-3 py-1.5"
        role="toolbar"
        aria-label={t('operationBar.selectionActions')}
      >
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-5 min-w-5 items-center justify-center rounded-[2px] bg-xp-lime px-1.5 text-[11px] font-medium text-xp-on-accent"
              aria-hidden="true"
            >
              {selectedFiles.size}
            </span>
            <span className="truncate text-xs font-medium text-xp-text" aria-live="polite">
              {t('common.selected', { count: selectedFiles.size })}
            </span>
            {onSelectNone && (
              <button
                type="button"
                onClick={onSelectNone}
                className="flex h-7 items-center gap-1 rounded-[2px] px-2 text-xs text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                title={t('topBar.clearSelection')}
                aria-label={t('topBar.clearSelection')}
              >
                <X size={13} aria-hidden="true" />
                <span>{t('common.clear')}</span>
              </button>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {selectedFiles.size === 1 && onPreview && (
              <button
                type="button"
                onClick={onPreview}
                className="flex h-8 items-center gap-1.5 rounded-[2px] px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.preview')}
                aria-label={t('operationBar.preview')}
              >
                <Eye size={15} aria-hidden="true" />
                <span className="hidden lg:inline">{t('common.preview')}</span>
              </button>
            )}
            {onCopy && (
              <button
                type="button"
                onClick={onCopy}
                className="flex h-8 items-center gap-1.5 rounded-[2px] px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('contextMenu.copy')}
                aria-label={t('contextMenu.copy')}
              >
                <Copy size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('contextMenu.copy')}</span>
              </button>
            )}
            {onCut && (
              <button
                type="button"
                onClick={onCut}
                className="flex h-8 items-center gap-1.5 rounded-[2px] px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('contextMenu.cut')}
                aria-label={t('contextMenu.cut')}
              >
                <Scissors size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('contextMenu.cut')}</span>
              </button>
            )}
            {onCompress && selectedFiles.size > 1 && (
              <button
                type="button"
                onClick={onCompress}
                className="flex h-8 items-center gap-1.5 rounded-[2px] px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.compress')}
                aria-label={t('operationBar.compress')}
              >
                <Package size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('operationBar.compress')}</span>
              </button>
            )}
            {onExtract && selectedFiles.size === 1 && (
              <button
                type="button"
                onClick={onExtract}
                className="flex h-8 items-center gap-1.5 rounded-[2px] px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.extract')}
                aria-label={t('operationBar.extract')}
              >
                <PackageOpen size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('operationBar.extract')}</span>
              </button>
            )}
            {onProperties && selectedFiles.size === 1 && (
              <button
                type="button"
                onClick={onProperties}
                className="flex h-8 items-center gap-1.5 rounded-[2px] px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.properties')}
                aria-label={t('operationBar.properties')}
              >
                <Info size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('operationBar.properties')}</span>
              </button>
            )}
            <div className="mx-1 h-5 w-px bg-xp-border" aria-hidden="true" />
            <button
              type="button"
              onClick={handleDelete}
              className="flex h-8 items-center gap-1.5 rounded-[2px] px-2.5 text-xs font-medium text-xp-red transition-colors hover:bg-xp-red/10"
              title={t('operationBar.deleteItems', { count: selectedFiles.size })}
              aria-label={t('operationBar.deleteItemsAria', { count: selectedFiles.size })}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span className="hidden lg:inline">{t('contextMenu.delete')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={barRef}
      className="wisp-operationbar wisp-component-toolbar wisp-no-select relative z-30 border-b border-xp-border bg-xp-surface px-3 py-1.5"
    >
      <div className="wisp-operationbar-layout flex items-center justify-between gap-4">
        <div className="wisp-toolbar-controls wisp-toolbar-controls-primary flex min-w-0 items-center">
          {/* Sort Dropdown */}
          <div className="relative">
            <button
              ref={sortTriggerRef}
              type="button"
              onClick={() => setOpenMenu((current) => (current === 'sort' ? null : 'sort'))}
              onKeyDown={(event) => handleMenuTriggerKeyDown('sort', event)}
              className="wisp-control flex items-center gap-1 rounded-[2px] px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:text-xp-text"
              aria-label={t('operationBar.sortBy', {
                name: currentSortLabel,
                order: currentSortOrder,
              })}
              aria-haspopup="menu"
              aria-expanded={openMenu === 'sort'}
            >
              <span className="whitespace-nowrap">{currentSortLabel}</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>

            {openMenu === 'sort' && sortOptions && (
              <div
                ref={sortMenuRef}
                role="menu"
                aria-label={t('operationBar.sortBy', {
                  name: currentSortLabel,
                  order: currentSortOrder,
                })}
                onKeyDown={(event) => handleMenuKeyDown('sort', event)}
                className="wisp-popover-menu border-xp-border/60 absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-[2px] border bg-xp-popover py-1 shadow-xl"
              >
                {Object.values(sortOptions).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sortBy === option.id}
                    tabIndex={-1}
                    onClick={() => {
                      if (sortBy === option.id) {
                        toggleSortOrder();
                      } else {
                        setSortBy(option.id);
                      }
                      setOpenMenu(null);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${
                      sortBy === option.id ? 'text-xp-blue' : ''
                    }`}
                  >
                    <span className="text-xs">{getSortLabel(option.id)}</span>
                    {sortBy === option.id &&
                      (sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </button>
                ))}

                {/* Group by Date toggle inside sort dropdown */}
                {setGroupByDate && (
                  <>
                    <div role="separator" className="my-1 border-t border-xp-border" />
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={Boolean(groupByDate)}
                      tabIndex={-1}
                      onClick={() => {
                        setGroupByDate(!groupByDate);
                        setOpenMenu(null);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${
                        groupByDate ? 'text-xp-blue' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Rows3 size={13} className="inline-block" />
                        <span className="text-xs">{t('operationBar.groupByDate')}</span>
                      </div>
                      {groupByDate && (
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* View Mode Dropdown */}
          <div className="relative flex items-center gap-1">
            <button
              ref={viewTriggerRef}
              type="button"
              onClick={() => setOpenMenu((current) => (current === 'view' ? null : 'view'))}
              onKeyDown={(event) => handleMenuTriggerKeyDown('view', event)}
              className="wisp-control flex items-center gap-1 rounded-[2px] px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:text-xp-text"
              aria-label={t('operationBar.viewMode', {
                name: currentViewLabel,
              })}
              aria-haspopup="menu"
              aria-expanded={openMenu === 'view'}
            >
              <span className="text-sm">{viewModes[viewMode]?.icon}</span>
              <span className="whitespace-nowrap">{currentViewLabel}</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>

            {openMenu === 'view' && (
              <div
                ref={viewMenuRef}
                role="menu"
                aria-label={t('operationBar.viewMode', { name: currentViewLabel })}
                onKeyDown={(event) => handleMenuKeyDown('view', event)}
                className="wisp-popover-menu border-xp-border/60 absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-[2px] border bg-xp-popover py-1 shadow-xl"
              >
                {Object.values(viewModes).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={viewMode === mode.id}
                    tabIndex={-1}
                    onClick={() => {
                      setViewMode(mode.id);
                      setOpenMenu(null);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${
                      viewMode === mode.id ? 'text-xp-blue' : ''
                    }`}
                  >
                    <span className="text-sm">{mode.icon}</span>
                    <span className="text-xs">{getViewLabel(mode.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Selection actions appear contextually instead of filling every empty state. */}
          {selectedFiles.size > 0 && (
            <div className="ml-1 flex items-center gap-0.5 rounded-[2px] border border-xp-border bg-muted px-1">
              <span className="px-1.5 text-[11px] font-medium tabular-nums text-xp-blue">
                {selectedFiles.size}
              </span>
              {selectedFiles.size === 1 && onPreview && (
                <button
                  onClick={onPreview}
                  className="rounded-[2px] p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('operationBar.preview')}
                  aria-label={t('operationBar.preview')}
                >
                  <Eye size={15} />
                </button>
              )}
              {onCopy && (
                <button
                  onClick={onCopy}
                  className="rounded-[2px] p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('contextMenu.copy')}
                  aria-label={t('contextMenu.copy')}
                >
                  <Copy size={15} />
                </button>
              )}
              {onCut && (
                <button
                  onClick={onCut}
                  className="rounded-[2px] p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('contextMenu.cut')}
                  aria-label={t('contextMenu.cut')}
                >
                  <Scissors size={15} />
                </button>
              )}
              <button
                onClick={handleDelete}
                className="rounded-[2px] p-1 text-xp-text-muted transition-colors hover:bg-xp-red/10 hover:text-xp-red"
                title={t('contextMenu.delete')}
                aria-label={t('contextMenu.delete')}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
          {onPaste && hasClipboard && (
            <button
              onClick={onPaste}
              className="rounded-[2px] p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              title={t('contextMenu.paste')}
              aria-label={t('contextMenu.paste')}
            >
              <Clipboard size={15} />
            </button>
          )}

          {/* Size Map toggle */}
          {onToggleSizeBadges && (
            <button
              onClick={onToggleSizeBadges}
              className={`wisp-control wisp-size-map-control flex items-center gap-1 rounded-[2px] px-2 py-1 text-xs transition-colors ${
                showSizeBadges
                  ? 'bg-xp-blue/10 text-xp-blue'
                  : 'text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text'
              }`}
              title={
                showSizeBadges
                  ? t('operationBar.hideSizeHeatmap')
                  : t('operationBar.showSizeHeatmap')
              }
              aria-label={
                showSizeBadges
                  ? t('operationBar.hideSizeHeatmap')
                  : t('operationBar.showSizeHeatmap')
              }
              aria-pressed={showSizeBadges}
            >
              <BarChart3 size={14} />
              <span className="wisp-size-map-label whitespace-nowrap">
                {t('operationBar.sizeMap')}
              </span>
            </button>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {statusAccessory && <div className="wisp-toolbar-accessory">{statusAccessory}</div>}

          <div className="wisp-toolbar-controls wisp-toolbar-controls-secondary flex flex-shrink-0 items-center">
            {/* Action Buttons */}
            <button
              onClick={handleCreateFolder}
              className="wisp-control flex items-center gap-1.5 rounded-[2px] px-2 py-1.5 text-xs font-medium text-xp-text transition-colors hover:text-xp-blue"
              title={t('operationBar.createFolder')}
              aria-label={t('operationBar.createFolder')}
            >
              <FolderPlus size={16} />
              <span className="hidden xl:inline">{t('operationBar.newFolder')}</span>
            </button>

            <button
              onClick={() => {
                setBottomPanelCollapsed(false);
                setBottomPanelTab('terminal');
              }}
              className="wisp-control-icon flex h-8 w-8 items-center justify-center rounded-[2px] text-xp-text-secondary transition-colors hover:text-xp-text"
              title={t('operationBar.openTerminal')}
              aria-label={t('operationBar.openTerminal')}
            >
              <Terminal size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OperationBar;
