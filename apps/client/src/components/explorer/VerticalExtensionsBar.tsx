import React, { useState, useMemo, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { extensionHost } from '@/lib/extension-host';
import { Eye, MoreHorizontal, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface VerticalExtensionsBarProps {
  rightPanelTab: string;
  setRightPanelTab: (tab: string) => void;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  'data-tour'?: string;
}

/**
 * The rail carries ONE primary tool: 预览. Everything else (活动, 扩展市场,
 * extension panels) lives behind a single hover/click "更多" slip at the
 * bottom. The AI panel is not surfaced.
 */
const VerticalExtensionsBar = ({
  rightPanelTab,
  setRightPanelTab,
  rightSidebarCollapsed,
  setRightSidebarCollapsed,
  'data-tour': dataTour,
}: VerticalExtensionsBarProps) => {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
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

  const morePanels = useMemo(
    () => [
      ...registeredPanels.map((panel) => ({
        id: panel.id,
        icon: panel.icon,
        label: panel.title,
      })),
      { id: 'performance', icon: null, label: t('extensionsBar.performance') },
      { id: 'marketplace', icon: null, label: t('extensionsBar.marketplace') },
    ],
    [registeredPanels, t],
  );

  const isActivePanel = (id: string) => {
    if (rightSidebarCollapsed) return false;
    return rightPanelTab === id;
  };

  const handlePanelClick = (id: string) => {
    if (isActivePanel(id)) {
      setRightSidebarCollapsed(true);
      return;
    }
    setRightPanelTab(id);
    if (rightSidebarCollapsed) setRightSidebarCollapsed(false);
  };

  return (
    <div
      data-tour={dataTour}
      className="wisp-panel-rail wisp-no-select relative flex w-12 flex-col border-l border-xp-border bg-xp-surface"
    >
      <div className="flex flex-col py-2">
        {/* 预览 — the one tool on the rail */}
        <button
          onClick={() => handlePanelClick('preview')}
          className={`relative mx-1 mb-1 flex h-10 w-10 items-center justify-center rounded-[2px] transition-all ${
            isActivePanel('preview')
              ? 'bg-xp-blue text-[var(--xp-bg)]'
              : 'text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text'
          }`}
          title={t('extensionsBar.preview')}
          aria-label={t('extensionsBar.preview')}
          aria-pressed={isActivePanel('preview')}
        >
          <Eye size={18} />
        </button>
      </div>

      <div className="flex-1" />

      {/* 更多 — 活动 / 扩展市场 / extension panels, on hover or click */}
      <div
        className="relative py-2"
        onMouseEnter={() => setMoreOpen(true)}
        onMouseLeave={() => setMoreOpen(false)}
      >
        {moreOpen && (
          <div
            className="paper-3 absolute bottom-12 left-1 z-20 min-w-[148px] rounded-[2px] py-1.5 shadow-[var(--xp-shadow-popover)]"
            role="menu"
          >
            {morePanels.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => {
                  handlePanelClick(id);
                  setMoreOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-xp-surface-light ${
                  isActivePanel(id) ? 'text-[var(--seal,#c0402b)]' : 'text-xp-text-secondary'
                }`}
                role="menuitem"
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={`mx-1 flex h-10 w-10 items-center justify-center rounded-[2px] transition-colors ${
            moreOpen || morePanels.some((p) => isActivePanel(p.id))
              ? 'bg-xp-surface-light text-xp-text'
              : 'text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text'
          }`}
          title={t('operationBar.actionsMenu')}
          aria-label={t('operationBar.actionsMenu')}
          aria-expanded={moreOpen}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>

      {/* Settings */}
      <div className="border-t border-xp-border py-2">
        <Link
          href={`/settings${window.location.search}`}
          className="mx-1 mb-1 flex h-10 w-10 items-center justify-center rounded-[2px] text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
          title={t('extensionsBar.settings')}
          aria-label={t('extensionsBar.settings')}
        >
          <Settings size={18} />
        </Link>
      </div>
    </div>
  );
};

export default VerticalExtensionsBar;
