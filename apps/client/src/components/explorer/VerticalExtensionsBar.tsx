import React, { useMemo, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { extensionHost } from '@/lib/extension-host';
import { Eye, Bot, ShoppingCart, Settings, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface VerticalExtensionsBarProps {
  rightPanelTab: string;
  setRightPanelTab: (tab: string) => void;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  'data-tour'?: string;
}

/**
 * The rail: 预览 first and largest, then Agent / 活动 / 扩展市场 / extension
 * panels as plain buttons. 预览 fills the inspector edge-to-edge; pressing
 * its button again folds the panel away. Spacing is compressed to keep the
 * column quiet.
 */
const VerticalExtensionsBar = ({
  rightPanelTab,
  setRightPanelTab,
  rightSidebarCollapsed,
  setRightSidebarCollapsed,
  'data-tour': dataTour,
}: VerticalExtensionsBarProps) => {
  const { t } = useTranslation();
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

  const panels = useMemo(
    () => [
      { id: 'preview', icon: <Eye size={16} />, label: t('extensionsBar.preview') },
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

  return (
    <div
      data-tour={dataTour}
      className="wisp-panel-rail wisp-no-select flex w-10 flex-col border-l border-xp-border bg-xp-surface"
    >
      <div className="flex flex-col py-1">
        {panels.map(({ id, icon, label, target }) => (
          <button
            key={id}
            onClick={() => handlePanelClick(id, target)}
            className={`mx-auto flex h-8 w-8 items-center justify-center rounded-[2px] transition-all ${
              isActivePanel(id)
                ? 'bg-xp-blue text-[var(--xp-bg)]'
                : 'text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text'
            }`}
            title={label}
            aria-label={label}
            aria-pressed={isActivePanel(id)}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="border-t border-xp-border py-1">
        <Link
          href={`/settings${window.location.search}`}
          className="mx-auto flex h-8 w-8 items-center justify-center rounded-[2px] text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
          title={t('extensionsBar.settings')}
          aria-label={t('extensionsBar.settings')}
        >
          <Settings size={16} />
        </Link>
      </div>
    </div>
  );
};

export default VerticalExtensionsBar;
