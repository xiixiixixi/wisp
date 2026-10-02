import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { extensionHost } from '@/lib/extension-host';
import {
  Columns,
  Rows,
  Eye,
  Bot,
  Settings,
  Ellipsis,
  File,
  Plug,
  Smartphone,
  Check,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '@/components/explorer/sidebar/navigation.css';
import { useHiddenFiles } from '@/hooks/use-hidden-files';

interface VerticalExtensionsBarProps {
  orientation?: 'vertical' | 'horizontal';
  rightPanelTab: string;
  setRightPanelTab: (tab: string) => void;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  /** 向右分割当前窗格（MainLayout 提供） */
  onSplitRight?: () => void;
  /** 向下分割当前窗格 */
  onSplitDown?: () => void;
}

/**
 * Preview is the primary, always-visible panel action. Less frequent panels
 * live behind one accessible overflow menu so the title bar stays quiet.
 */
const VerticalExtensionsBar = ({
  orientation = 'vertical',
  rightPanelTab,
  setRightPanelTab,
  rightSidebarCollapsed,
  setRightSidebarCollapsed,
  onSplitRight,
  onSplitDown,
}: VerticalExtensionsBarProps) => {
  const { t } = useTranslation();
  const { showHiddenFiles, toggleHiddenFiles } = useHiddenFiles();
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const initialMenuFocusRef = useRef<'first' | 'last'>('first');
  const keyboardOpenRef = useRef(false);
  const extRefreshKey = useSyncExternalStore(
    extensionHost.subscribe,
    extensionHost.getSnapshotVersion,
  );

  const registeredPanels = useMemo(() => {
    try {
      return extensionHost.getRegisteredPanels();
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extRefreshKey]);

  const secondaryPanels = useMemo(
    () => [
      {
        id: 'chat',
        icon: <Bot size={16} />,
        label: t('extensionsBar.chat'),
        target: 'chat',
      },
      { id: 'chatgpt-bridge', icon: <Plug size={16} />, label: t('extensionsBar.chatgptBridge') },
      {
        id: 'weixin',
        icon: <Smartphone size={16} />,
        label: t('extensionsBar.weixin'),
        target: 'weixin-bridge',
      },
      ...registeredPanels.map((panel) => ({
        id: panel.id,
        icon: panel.icon,
        label: panel.title,
        target: undefined as string | undefined,
      })),
      {
        id: 'settings-entry',
        icon: <Settings size={16} />,
        label: t('extensionsBar.settings'),
      },
    ],
    [registeredPanels, t],
  );

  const isActivePanel = (id: string) => {
    if (rightSidebarCollapsed) return false;
    if (id === 'weixin') return rightPanelTab === 'weixin-bridge';
    return rightPanelTab === id;
  };

  const handlePanelClick = (id: string, target?: string) => {
    const next = target ?? id;
    if (isActivePanel(id)) {
      setRightSidebarCollapsed(true);
      return;
    }
    setRightPanelTab(next);
    if (rightSidebarCollapsed) setRightSidebarCollapsed(false);
  };

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuTriggerRef.current?.focus());
  }, []);

  const handleSecondaryPanelClick = (id: string, target?: string) => {
    closeMenu();
    handlePanelClick(id, target);
  };

  const getMenuItems = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]',
        ) ?? [],
      ),
    [],
  );

  const focusMenuItem = useCallback(
    (position: 'first' | 'last' | 'next' | 'previous') => {
      const items = getMenuItems();
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
    },
    [getMenuItems],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const focusFrame = requestAnimationFrame(() => {
      // 鼠标打开不预聚焦（macOS 惯例）；键盘打开（方向键）才高亮首/末项。
      if (keyboardOpenRef.current) focusMenuItem(initialMenuFocusRef.current);
      keyboardOpenRef.current = false;
      initialMenuFocusRef.current = 'first';
    });
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeMenu, focusMenuItem, menuOpen]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusMenuItem('next');
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusMenuItem('previous');
        break;
      case 'Home':
        event.preventDefault();
        focusMenuItem('first');
        break;
      case 'End':
        event.preventDefault();
        focusMenuItem('last');
        break;
      case 'Escape':
        event.preventDefault();
        closeMenu(true);
        break;
    }
  };

  const hasActiveSecondaryPanel = secondaryPanels.some(({ id }) => isActivePanel(id));
  const previewLabel = t('extensionsBar.preview');
  const moreToolsLabel = t('extensionsBar.moreTools');

  return (
    <div
      className={`wisp-panel-rail wisp-no-select ${orientation === 'horizontal' ? 'wisp-panel-rail-horizontal' : 'wisp-panel-rail-vertical'}`}
    >
      <div className="wisp-tools-actions">
        <button
          type="button"
          onClick={toggleHiddenFiles}
          aria-label={t('extensionsBar.hiddenFiles')}
          aria-pressed={showHiddenFiles}
          title={`${t('extensionsBar.hiddenFiles')} (${isMac ? '⌘⇧.' : 'Ctrl+Shift+.'})`}
          className={`wisp-rail-button wisp-named-tool ${
            showHiddenFiles ? 'text-xp-accent' : 'text-xp-text-secondary hover:text-xp-text'
          }`}
          data-testid="rail-hidden-files"
        >
          <File
            size={16}
            strokeDasharray={showHiddenFiles ? undefined : '2.5 2.5'}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={() => handlePanelClick('preview')}
          className="wisp-rail-button wisp-named-tool"
          title={previewLabel}
          aria-label={previewLabel}
          aria-pressed={isActivePanel('preview')}
        >
          <Eye size={16} aria-hidden="true" />
        </button>
        <div ref={menuRootRef} className="relative">
          <button
            ref={menuTriggerRef}
            type="button"
            onClick={(event) => {
              keyboardOpenRef.current = event.detail === 0;
              setMenuOpen((open) => !open);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                initialMenuFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
                keyboardOpenRef.current = true;
                setMenuOpen(true);
              }
            }}
            className="wisp-rail-button wisp-named-tool"
            title={moreToolsLabel}
            aria-label={moreToolsLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-pressed={hasActiveSecondaryPanel}
          >
            <Ellipsis size={17} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              aria-label={moreToolsLabel}
              onKeyDown={handleMenuKeyDown}
              onBlur={() =>
                requestAnimationFrame(() => {
                  if (!menuRootRef.current?.contains(document.activeElement)) closeMenu();
                })
              }
              className={`wisp-panel-overflow-menu wisp-tools-menu absolute z-[100] rounded-xl border border-xp-border bg-xp-popover p-1.5 shadow-[var(--xp-shadow-popover)] ${orientation === 'horizontal' ? 'right-0 top-[calc(100%+8px)]' : 'left-[calc(100%+8px)] top-0'}`}
            >
              <div className="wisp-tools-menu-heading" role="presentation">
                {t('extensionsBar.panels')}
              </div>
              {secondaryPanels.map(({ id, icon, label, target }) => {
                const active = isActivePanel(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role={id === 'settings-entry' ? 'menuitem' : 'menuitemradio'}
                    aria-checked={id === 'settings-entry' ? undefined : active}
                    tabIndex={-1}
                    onClick={() => {
                      if (id === 'settings-entry') {
                        closeMenu(false);
                        window.dispatchEvent(
                          new CustomEvent('wisp-open-settings', {
                            detail: { returnFocus: menuTriggerRef.current },
                          }),
                        );
                        return;
                      }
                      handleSecondaryPanelClick(id, target);
                    }}
                    className="wisp-tools-menu-item"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center"
                      aria-hidden="true"
                    >
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {active && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 胶囊2：分栏（向右/向下） */}
      {(onSplitRight || onSplitDown) && (
        <div className="wisp-split-group">
          {onSplitRight && (
            <button
              type="button"
              onClick={onSplitRight}
              title={t('splitView.splitRight')}
              aria-label={t('splitView.splitRight')}
              className="wisp-rail-button wisp-named-tool text-xp-text-secondary hover:text-xp-text"
            >
              <Columns size={16} aria-hidden="true" />
            </button>
          )}
          {onSplitDown && (
            <button
              type="button"
              onClick={onSplitDown}
              title={t('splitView.splitDown')}
              aria-label={t('splitView.splitDown')}
              className="wisp-rail-button wisp-named-tool text-xp-text-secondary hover:text-xp-text"
            >
              <Rows size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default VerticalExtensionsBar;
