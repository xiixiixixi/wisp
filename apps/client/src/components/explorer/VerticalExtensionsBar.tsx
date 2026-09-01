import React, { useMemo, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { extensionHost } from '@/lib/extension-host';
import { Eye, Bot, ShoppingCart, Settings, Activity } from 'lucide-react';
import AgentStatusIndicator from '@/components/panels/agent-manager/AgentStatusIndicator';
import { useTranslation } from 'react-i18next';

interface VerticalExtensionsBarProps {
  rightPanelTab: string;
  setRightPanelTab: (tab: string) => void;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  'data-tour'?: string;
}

const VerticalExtensionsBar = ({
  rightPanelTab,
  setRightPanelTab,
  rightSidebarCollapsed,
  setRightSidebarCollapsed,
  'data-tour': dataTour,
}: VerticalExtensionsBarProps) => {
  const { t } = useTranslation();
  // useSyncExternalStore ensures re-renders when extension host state changes
  const extRefreshKey = useSyncExternalStore(
    extensionHost.subscribe,
    extensionHost.getSnapshotVersion,
  );

  // Dynamic panels from extension host (re-read on every version change)
  // useMemo with extRefreshKey ensures React properly re-computes when extensions change
  const registeredPanels = useMemo(() => {
    try {
      return extensionHost.getRegisteredPanels();
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extRefreshKey]);

  const corePanels = useMemo(
    () => [
      { id: 'preview', icon: <Eye size={18} />, label: t('extensionsBar.preview') },
      {
        id: 'ai',
        icon: (
          <AgentStatusIndicator>
            <Bot size={18} />
          </AgentStatusIndicator>
        ),
        label: t('extensionsBar.agent'),
      },
    ],
    [t],
  );

  const advancedPanels = useMemo(
    () => [
      ...registeredPanels.map((panel) => ({
        id: panel.id,
        icon: panel.icon,
        label: panel.title,
      })),
      { id: 'performance', icon: <Activity size={18} />, label: t('extensionsBar.performance') },
      {
        id: 'marketplace',
        icon: <ShoppingCart size={18} />,
        label: t('extensionsBar.marketplace'),
      },
    ],
    [registeredPanels, t],
  );

  const handlePanelClick = (id: string) => {
    setRightPanelTab(id === 'ai' ? 'agent-manager' : id);
    if (rightSidebarCollapsed) {
      setRightSidebarCollapsed(false);
    }
  };

  const isActivePanel = (id: string) => {
    if (rightSidebarCollapsed) return false;
    if (id === 'ai') return rightPanelTab === 'chat' || rightPanelTab === 'agent-manager';
    return rightPanelTab === id;
  };

  const btnClass = (id: string) =>
    `relative w-10 h-10 mx-1 mb-1 rounded-xl flex items-center justify-center text-lg transition-all ${
      isActivePanel(id)
        ? 'bg-xp-blue text-[var(--xp-bg)]'
        : 'text-xp-text-secondary hover:text-xp-text hover:bg-xp-surface-light'
    }`;

  return (
    <div
      data-tour={dataTour}
      className="wisp-panel-rail wisp-no-select flex w-12 flex-col border-l border-xp-border bg-xp-surface"
    >
      <div className="flex flex-col py-2">
        {/* Core panels (always available) */}
        {corePanels.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => handlePanelClick(id)}
            className={btnClass(id)}
            title={label}
          >
            {icon}
          </button>
        ))}

        {/* Advanced and extension panels, directly on the rail */}
        <div className="mx-2 my-1 border-t border-xp-border" />
        {advancedPanels.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => handlePanelClick(id)}
            className={btnClass(id)}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <div className="border-t border-xp-border py-2">
        <Link
          href={`/settings${window.location.search}`}
          className="mx-1 mb-1 flex h-10 w-10 items-center justify-center rounded-xl text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
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
