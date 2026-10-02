import React, { useState, useEffect, useRef } from 'react';
import '@/styles/container-collapse.css';
import {
  ArrowUp,
  ArrowUpDown,
  ArrowDown,
  ChevronDown,
  Rows3,
  FilePlus,
  FolderPlus,
  Package,
  PackageOpen,
  Terminal,
  Clipboard,
  MoreHorizontal,
  ChevronUp,
  RefreshCw,
  Check,
  Radio,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SortField } from '@/lib/utils';
import { AnchoredMenu } from '@/components/ui/AnchoredMenu';
import { openAirDrop } from '@/lib/tauri-api/airdrop';
import { isTauri } from '@/lib/transport';
import { toast } from '@/hooks/use-toast';
import { usePaneWidth } from '@/hooks/use-pane-width';

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

type OperationMenu = 'sort' | 'view' | 'more';

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
  onCreateFile?: () => void;
  handleDelete: () => void;
  selectedFiles: Set<string>;
  setBottomPanelCollapsed: (collapsed: boolean) => void;
  setBottomPanelTab: (tab: 'terminal' | 'output' | 'git' | string) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  onInvertSelection?: () => void;
  onAdvancedSelection?: () => void;
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
  overflowAccessory?: React.ReactNode;
  onRefresh?: () => void;
  onNavigateUp?: () => void;
  canNavigateUp?: boolean;
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
  onCreateFile,
  handleDelete: _handleDelete,
  selectedFiles,
  setBottomPanelCollapsed,
  setBottomPanelTab,
  onSelectAll: _onSelectAll,
  onInvertSelection: _onInvertSelection,
  onAdvancedSelection: _onAdvancedSelection,
  isAutoDetected: _isAutoDetected,
  onClearAutoDetect: _onClearAutoDetect,
  onCompress,
  onExtract,
  onProperties: _onProperties,
  currentPath: _currentPath,
  onCopy: _onCopy,
  onCut: _onCut,
  onPaste,
  hasClipboard,
  onPreview: _onPreview,
  statusAccessory,
  overflowAccessory,
  onRefresh,
  onNavigateUp,
  canNavigateUp = false,
}: OperationBarProps) => {
  const { t } = useTranslation();
  const hasSelection = selectedFiles.size > 0;
  const [openMenu, setOpenMenu] = useState<OperationMenu | null>(null);
  const [airDropOpening, setAirDropOpening] = useState(false);
  const airDropOpeningRef = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const focusedControlRef = useRef<HTMLElement | null>(null);
  const paneWidth = usePaneWidth(barRef);
  const compact = paneWidth <= 600;
  const hideCreateFolder = paneWidth <= 480;
  const collapseBrowse = paneWidth <= 360;

  const triggerFor = (menu: OperationMenu) => {
    if (menu === 'sort') return sortTriggerRef.current;
    if (menu === 'view') return viewTriggerRef.current;
    return moreTriggerRef.current;
  };

  const menuFor = (menu: OperationMenu) => {
    if (menu === 'sort') return sortMenuRef.current;
    if (menu === 'view') return viewMenuRef.current;
    return moreMenuRef.current;
  };

  useEffect(() => {
    const focused = focusedControlRef.current;
    const focusWasInMenu = Boolean(
      focused &&
      [sortMenuRef.current, viewMenuRef.current, moreMenuRef.current].some((menu) =>
        menu?.contains(focused),
      ),
    );
    setOpenMenu(null);
    if (!focused || (!focusWasInMenu && focused.isConnected)) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== document.body && document.activeElement !== focused) return;
      (moreTriggerRef.current ?? sortTriggerRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [compact, collapseBrowse, hideCreateFolder]);

  const closeMenu = (restoreFocus = false) => {
    const menu = openMenu;
    setOpenMenu(null);
    if (restoreFocus && menu) triggerFor(menu)?.focus();
  };

  const toggleMenu = (menu: OperationMenu, keyboardActivated = false) => {
    if (openMenu === menu) {
      setOpenMenu(null);
    } else {
      // 鼠标打开：不预聚焦菜单项（macOS 惯例——焦点高亮只属于键盘导航；
      // 预聚焦会让第一项显示实心蓝，看起来像错误的当前视图）。
      // Enter/Space 合成的 click（detail=0）与方向键路径仍聚焦。
      setOpenMenu(menu);
      if (keyboardActivated) {
        requestAnimationFrame(() => focusMenuItem(menu, 'first'));
      }
    }
  };

  const menuItems = (menu: OperationMenu) =>
    Array.from(
      menuFor(menu)?.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
      ) ?? [],
    ).filter((item) => !item.matches(':disabled'));

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
    // Enter/Space use the button's native click, which shares pointer behavior.
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
      case 'Tab': {
        // A portal sits at the end of body, not beside its toolbar trigger.
        // Continue from the trigger's document position in either direction.
        event.preventDefault();
        const trigger = triggerFor(menu);
        const tabbable = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden' &&
            !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
            !menuFor(menu)?.contains(element),
        );
        const index = trigger ? tabbable.indexOf(trigger) : -1;
        const next = tabbable[index + (event.shiftKey ? -1 : 1)];
        (next ?? trigger)?.focus();
        setOpenMenu(null);
        break;
      }
    }
  };

  useEffect(() => {
    if (!openMenu) return;
    // Capture phase: pane/drag handlers that stopPropagation on mousedown
    // would otherwise swallow the event before it reaches this listener.
    // The click fallback also covers synthetic accessibility presses that
    // never dispatch pointer events.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !barRef.current?.contains(target) &&
        !sortMenuRef.current?.contains(target) &&
        !viewMenuRef.current?.contains(target) &&
        !moreMenuRef.current?.contains(target)
      ) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const menu = openMenu;
        setOpenMenu(null);
        requestAnimationFrame(() => {
          triggerFor(menu)?.focus();
        });
      }
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !barRef.current?.contains(target) &&
        !sortMenuRef.current?.contains(target) &&
        !viewMenuRef.current?.contains(target) &&
        !moreMenuRef.current?.contains(target)
      ) {
        setOpenMenu(null);
      }
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

  const handleAirDrop = async () => {
    if (airDropOpeningRef.current) return;
    if (!isTauri()) {
      toast({ title: 'AirDrop', description: t('operationBar.airDrop.desktopOnly') });
      return;
    }
    airDropOpeningRef.current = true;
    setAirDropOpening(true);
    try {
      await openAirDrop(Array.from(selectedFiles));
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      const descriptions: Record<string, string> = {
        unsupported: 'operationBar.airDrop.desktopOnly',
        invalid_paths: 'operationBar.airDrop.invalidPaths',
        unavailable: 'operationBar.airDrop.unavailable',
      };
      toast({
        title: t('operationBar.airDrop.openFailed'),
        description: t(
          (typeof code === 'string' && descriptions[code]) || 'operationBar.airDrop.tryAgain',
        ),
        variant: 'destructive',
      });
    } finally {
      airDropOpeningRef.current = false;
      setAirDropOpening(false);
    }
  };

  const airDropButton = (
    <button
      type="button"
      onClick={() => void handleAirDrop()}
      disabled={airDropOpening}
      aria-busy={airDropOpening}
      aria-label="AirDrop"
      title={t(selectedFiles.size > 0 ? 'operationBar.airDrop.share' : 'operationBar.airDrop.open')}
      className="wisp-control-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xp-text-secondary transition-colors hover:text-xp-text disabled:opacity-50"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5.64 18.36a9 9 0 1 1 12.72 0M8.12 15.88a5.5 5.5 0 1 1 7.76 0" />
        <circle cx="12" cy="12" r="2" />
        <path d="m12 17-4 5h8l-4-5Z" />
      </svg>
    </button>
  );

  const sortItems = (
    <>
      {Object.values(sortOptions).map((option) => (
        <button
          key={option.id}
          type="button"
          role="menuitemradio"
          aria-checked={sortBy === option.id}
          tabIndex={-1}
          onClick={() => {
            if (sortBy === option.id) toggleSortOrder();
            else setSortBy(option.id);
            closeMenu(true);
          }}
          className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${sortBy === option.id ? 'text-xp-blue' : ''}`}
        >
          <span className="text-xs">{getSortLabel(option.id)}</span>
          {sortBy === option.id &&
            (sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
        </button>
      ))}
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
              closeMenu(true);
            }}
            className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${groupByDate ? 'text-xp-blue' : ''}`}
          >
            <span className="flex items-center gap-2 text-xs">
              <Rows3 size={13} aria-hidden="true" />
              {t('operationBar.groupByDate')}
            </span>
            {groupByDate && <Check size={14} aria-hidden="true" />}
          </button>
        </>
      )}
    </>
  );

  const viewItems = Object.values(viewModes).map((mode) => (
    <button
      key={mode.id}
      type="button"
      role="menuitemradio"
      aria-checked={viewMode === mode.id}
      tabIndex={-1}
      onClick={() => {
        setViewMode(mode.id);
        closeMenu(true);
      }}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${viewMode === mode.id ? 'text-xp-blue' : ''}`}
    >
      <span className="text-sm">{mode.icon}</span>
      <span className="flex-1 text-xs">{getViewLabel(mode.id)}</span>
      {viewMode === mode.id && <Check size={14} aria-hidden="true" />}
    </button>
  ));

  const moreActions = [
    ...(onNavigateUp
      ? [
          {
            id: 'up',
            label: t('topBar.goUp'),
            icon: ChevronUp,
            run: onNavigateUp,
            disabled: !canNavigateUp,
          },
        ]
      : []),
    ...(onRefresh
      ? [{ id: 'refresh', label: t('topBar.refresh'), icon: RefreshCw, run: onRefresh }]
      : []),
    ...(hideCreateFolder
      ? [
          {
            id: 'folder',
            label: t('operationBar.createFolder'),
            icon: FolderPlus,
            run: handleCreateFolder,
          },
        ]
      : []),
    ...(onCreateFile
      ? [{ id: 'file', label: t('operationBar.createFile'), icon: FilePlus, run: onCreateFile }]
      : []),
    ...(onPaste && hasClipboard
      ? [{ id: 'paste', label: t('contextMenu.paste'), icon: Clipboard, run: onPaste }]
      : []),
    ...(hasSelection && onCompress && selectedFiles.size > 1
      ? [{ id: 'compress', label: t('operationBar.compress'), icon: Package, run: onCompress }]
      : []),
    ...(hasSelection && onExtract && selectedFiles.size === 1
      ? [{ id: 'extract', label: t('operationBar.extract'), icon: PackageOpen, run: onExtract }]
      : []),
    {
      id: 'airdrop',
      label: 'AirDrop',
      icon: Radio,
      run: () => void handleAirDrop(),
      disabled: airDropOpening,
    },
    {
      id: 'terminal',
      label: t('operationBar.openTerminal'),
      icon: Terminal,
      run: () => {
        setBottomPanelCollapsed(false);
        setBottomPanelTab('terminal');
      },
    },
  ];

  return (
    <div
      ref={barRef}
      onFocusCapture={(event) => {
        focusedControlRef.current = event.target as HTMLElement;
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (
          next instanceof Node &&
          !barRef.current?.contains(next) &&
          !sortMenuRef.current?.contains(next) &&
          !viewMenuRef.current?.contains(next) &&
          !moreMenuRef.current?.contains(next)
        ) {
          focusedControlRef.current = null;
        }
      }}
      data-compact={compact || undefined}
      className="wisp-operationbar wisp-component-toolbar wisp-no-select relative z-30 border-b border-xp-border bg-xp-surface px-3 py-1.5"
    >
      <div className="wisp-operationbar-layout flex items-center justify-between gap-4">
        {!collapseBrowse && (
          <div className="wisp-toolbar-controls wisp-toolbar-controls-primary flex min-w-0 items-center">
            {/* Sort Dropdown */}
            <div className="relative">
              <button
                ref={sortTriggerRef}
                type="button"
                onClick={(e) => toggleMenu('sort', e.detail === 0)}
                onKeyDown={(event) => handleMenuTriggerKeyDown('sort', event)}
                className="wisp-control flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:text-xp-text"
                aria-label={t('operationBar.sortBy', {
                  name: currentSortLabel,
                  order: currentSortOrder,
                })}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'sort'}
              >
                <ArrowUpDown size={14} aria-hidden="true" />
                <span className="ob-label-md whitespace-nowrap">{currentSortLabel}</span>
                <ChevronDown size={12} className="opacity-60" />
              </button>

              {openMenu === 'sort' && sortOptions && (
                <AnchoredMenu
                  menuRef={sortMenuRef}
                  anchorRef={sortTriggerRef}
                  role="menu"
                  aria-label={t('operationBar.sortBy', {
                    name: currentSortLabel,
                    order: currentSortOrder,
                  })}
                  onKeyDown={(event) => handleMenuKeyDown('sort', event)}
                  className="wisp-popover-menu border-xp-border/60 min-w-[180px] rounded-xl border bg-xp-popover py-1 shadow-xl"
                >
                  {sortItems}
                </AnchoredMenu>
              )}
            </div>

            {/* View Mode Dropdown */}
            <div className="relative flex items-center gap-1">
              <button
                ref={viewTriggerRef}
                type="button"
                onClick={(e) => toggleMenu('view', e.detail === 0)}
                onKeyDown={(event) => handleMenuTriggerKeyDown('view', event)}
                className="wisp-control flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:text-xp-text"
                aria-label={t('operationBar.viewMode', {
                  name: currentViewLabel,
                })}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'view'}
              >
                <span className="text-sm">{viewModes[viewMode]?.icon}</span>
                <span className="ob-label-md whitespace-nowrap">{currentViewLabel}</span>
                <ChevronDown size={12} className="opacity-60" />
              </button>

              {openMenu === 'view' && (
                <AnchoredMenu
                  menuRef={viewMenuRef}
                  anchorRef={viewTriggerRef}
                  role="menu"
                  aria-label={t('operationBar.viewMode', { name: currentViewLabel })}
                  onKeyDown={(event) => handleMenuKeyDown('view', event)}
                  className="wisp-popover-menu border-xp-border/60 min-w-[180px] rounded-xl border bg-xp-popover py-1 shadow-xl"
                >
                  {viewItems}
                </AnchoredMenu>
              )}
            </div>
          </div>
        )}

        <div className="flex min-w-0 items-center gap-2">
          {!compact && statusAccessory && (
            <div className="wisp-toolbar-accessory">{statusAccessory}</div>
          )}

          <div
            className={`wisp-toolbar-controls wisp-toolbar-controls-secondary flex flex-shrink-0 items-center ${
              hasSelection ? 'wisp-selection-actions' : ''
            }`}
            role={hasSelection ? 'toolbar' : undefined}
            aria-label={hasSelection ? t('operationBar.selectionActions') : undefined}
          >
            {/* Action Buttons */}
            {!compact && airDropButton}
            {!compact && hasSelection && onCompress && selectedFiles.size > 1 && (
              <button
                type="button"
                onClick={onCompress}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.compress')}
                aria-label={t('operationBar.compress')}
              >
                <Package size={15} aria-hidden="true" />
              </button>
            )}
            {!compact && hasSelection && onExtract && selectedFiles.size === 1 && (
              <button
                type="button"
                onClick={onExtract}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.extract')}
                aria-label={t('operationBar.extract')}
              >
                <PackageOpen size={15} aria-hidden="true" />
              </button>
            )}
            {!hideCreateFolder && (
              <button
                onClick={handleCreateFolder}
                className="wisp-control-icon flex h-8 w-8 items-center justify-center rounded-md text-xp-text-secondary transition-colors hover:text-xp-text"
                title={t('operationBar.createFolder')}
                aria-label={t('operationBar.createFolder')}
              >
                <FolderPlus size={16} />
              </button>
            )}
            {!compact && onCreateFile && (
              <button
                onClick={onCreateFile}
                className="wisp-control-icon flex h-8 w-8 items-center justify-center rounded-md text-xp-text-secondary transition-colors hover:text-xp-text"
                title={t('operationBar.createFile')}
                aria-label={t('operationBar.createFile')}
              >
                <FilePlus size={16} />
              </button>
            )}
            {!compact && onPaste && hasClipboard && (
              <button
                onClick={onPaste}
                className="wisp-control-icon flex h-8 w-8 items-center justify-center rounded-md text-xp-text-secondary transition-colors hover:text-xp-text"
                title={t('contextMenu.paste')}
                aria-label={t('contextMenu.paste')}
                data-testid="op-paste"
              >
                <Clipboard size={16} />
              </button>
            )}

            {!compact && (
              <button
                onClick={() => {
                  setBottomPanelCollapsed(false);
                  setBottomPanelTab('terminal');
                }}
                className="wisp-control-icon flex h-8 w-8 items-center justify-center rounded-md text-xp-text-secondary transition-colors hover:text-xp-text"
                title={t('operationBar.openTerminal')}
                aria-label={t('operationBar.openTerminal')}
              >
                <Terminal size={16} />
              </button>
            )}
            {compact && (
              <button
                ref={moreTriggerRef}
                type="button"
                className="wisp-control-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xp-text-secondary transition-colors hover:text-xp-text"
                title={t('contextMenu.more')}
                aria-label={t('contextMenu.more')}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'more'}
                onClick={(event) => toggleMenu('more', event.detail === 0)}
                onKeyDown={(event) => handleMenuTriggerKeyDown('more', event)}
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
      {openMenu === 'more' && compact && (
        <AnchoredMenu
          menuRef={moreMenuRef}
          anchorRef={moreTriggerRef}
          role="menu"
          aria-label={t('contextMenu.more')}
          onKeyDown={(event) => handleMenuKeyDown('more', event)}
          className="border-xp-border/60 min-w-[200px] rounded-xl border bg-xp-popover py-1 shadow-xl"
        >
          {moreActions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={'disabled' in action && action.disabled}
              onClick={() => {
                closeMenu(true);
                action.run();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-xp-surface-light disabled:opacity-40"
            >
              <action.icon size={14} className="shrink-0" aria-hidden="true" />
              <span>{action.label}</span>
            </button>
          ))}
          {overflowAccessory && (
            <div
              className="wisp-toolbar-accessory"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) closeMenu(true);
              }}
            >
              {overflowAccessory}
            </div>
          )}
          {collapseBrowse && (
            <>
              <div role="separator" className="my-1 border-t border-xp-border" />
              <div
                role="group"
                aria-label={t('operationBar.sortBy', {
                  name: currentSortLabel,
                  order: currentSortOrder,
                })}
              >
                <div className="px-3 py-1 text-xs text-xp-text-muted">
                  {t('operationBar.sortBy', { name: currentSortLabel, order: currentSortOrder })}
                </div>
                {sortItems}
              </div>
              <div role="separator" className="my-1 border-t border-xp-border" />
              <div role="group" aria-label={t('operationBar.viewMode', { name: currentViewLabel })}>
                <div className="px-3 py-1 text-xs text-xp-text-muted">
                  {t('operationBar.viewMode', { name: currentViewLabel })}
                </div>
                {viewItems}
              </div>
            </>
          )}
        </AnchoredMenu>
      )}
    </div>
  );
};

export default OperationBar;
