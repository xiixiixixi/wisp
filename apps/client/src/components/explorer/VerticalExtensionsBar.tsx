import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation } from 'wouter';
import { extensionHost } from '@/lib/extension-host';
import { Eye, Bot, ShoppingCart, Settings, Activity, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface VerticalExtensionsBarProps {
  orientation?: 'vertical' | 'horizontal';
  rightPanelTab: string;
  setRightPanelTab: (tab: string) => void;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  'data-tour'?: string;
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
  'data-tour': dataTour,
}: VerticalExtensionsBarProps) => {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const initialMenuFocusRef = useRef<'first' | 'last'>('first');
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
        id: 'ai',
        icon: <Bot size={16} />,
        label: t('extensionsBar.agent'),
        target: 'agent-manager',
      },
      ...registeredPanels.map((panel) => ({
        id: panel.id,
        icon: panel.icon,
        label: panel.title,
        target: undefined as string | undefined,
      })),
      { id: 'performance', icon: <Activity size={16} />, label: t('extensionsBar.performance') },
      {
        id: 'marketplace',
        icon: <ShoppingCart size={16} />,
        label: t('extensionsBar.marketplace'),
      },
    ],
    [registeredPanels, t],
  );

  const isActivePanel = (id: string) => {
    if (rightSidebarCollapsed) return false;
    if (id === 'ai') return rightPanelTab === 'chat' || rightPanelTab === 'agent-manager';
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
          '[role="menuitemradio"], [role="menuitem"]',
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
      focusMenuItem(initialMenuFocusRef.current);
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
      data-tour={dataTour}
      className={`wisp-panel-rail wisp-no-select flex border-xp-border bg-xp-surface ${
        orientation === 'horizontal'
          ? 'wisp-panel-rail-horizontal flex-row items-center'
          : 'w-10 flex-col border-l'
      }`}
    >
      <div className={`flex ${orientation === 'horizontal' ? 'flex-row' : 'flex-col py-1'}`}>
        <button
          onClick={() => handlePanelClick('preview')}
          className={`wisp-rail-button flex h-8 w-8 items-center justify-center rounded-[2px] transition-all ${
            isActivePanel('preview')
              ? 'bg-xp-blue text-[var(--xp-bg)]'
              : 'text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text'
          }`}
          title={previewLabel}
          aria-label={previewLabel}
          aria-pressed={isActivePanel('preview')}
        >
          <Eye size={16} />
        </button>

        <div ref={menuRootRef} className="relative">
          <button
            ref={menuTriggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                initialMenuFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
                setMenuOpen(true);
              }
            }}
            className={`wisp-rail-button flex h-8 w-8 items-center justify-center rounded-[2px] transition-all ${
              hasActiveSecondaryPanel
                ? 'bg-xp-blue text-[var(--xp-bg)]'
                : 'text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text'
            }`}
            title={moreToolsLabel}
            aria-label={moreToolsLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-pressed={hasActiveSecondaryPanel}
          >
            <Ellipsis size={17} />
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              aria-label={moreToolsLabel}
              onKeyDown={handleMenuKeyDown}
              onBlur={() => {
                requestAnimationFrame(() => {
                  if (!menuRootRef.current?.contains(document.activeElement)) closeMenu();
                });
              }}
              className={`wisp-panel-overflow-menu absolute z-[100] min-w-48 rounded-[12px] border border-xp-border bg-xp-popover p-1.5 shadow-[var(--xp-shadow-popover)] ${
                orientation === 'horizontal'
                  ? 'right-0 top-[calc(100%+8px)]'
                  : 'right-[calc(100%+8px)] top-0'
              }`}
            >
              {secondaryPanels.map(({ id, icon, label, target }) => {
                const active = isActivePanel(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    tabIndex={-1}
                    onClick={() => handleSecondaryPanelClick(id, target)}
                    className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-xs transition-colors ${
                      active
                        ? 'bg-xp-blue/15 font-medium text-xp-blue'
                        : 'text-xp-text hover:bg-xp-surface-light'
                    }`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center text-xp-text-secondary">
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  </button>
                );
              })}

              <div className="my-1 border-t border-xp-border" aria-hidden="true" />

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  closeMenu();
                  navigate(`/settings${window.location.search}`);
                }}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
              >
                <span className="flex h-5 w-5 items-center justify-center text-xp-text-secondary">
                  <Settings size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate">{t('extensionsBar.settings')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {orientation === 'vertical' && <div className="flex-1" />}
    </div>
  );
};

export default VerticalExtensionsBar;
