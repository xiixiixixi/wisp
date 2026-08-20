import React, { useMemo, useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';
import i18n from '@/i18n';
import { extensionHost } from '@/lib/extension-host';
import {
  Eye,
  Search,
  MessageSquare,
  Bot,
  Puzzle,
  ShoppingCart,
  Settings,
  Activity,
} from 'lucide-react';
import AgentStatusIndicator from '@/components/panels/agent-manager/AgentStatusIndicator';

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
  const [, setLocation] = useLocation();

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

  // Core panels (always shown, part of the app core)
  const corePanels = [
    { id: 'preview', icon: <Eye size={18} />, label: i18n.t('panels.core.preview') },
    { id: 'tokenizer', icon: <Search size={18} />, label: i18n.t('panels.core.tokenizer') },
    { id: 'chat', icon: <MessageSquare size={18} />, label: i18n.t('panels.core.chat') },
    {
      id: 'agent-manager',
      icon: (
        <AgentStatusIndicator>
          <Bot size={18} />
        </AgentStatusIndicator>
      ),
      label: i18n.t('panels.core.agentManager'),
    },
  ];

  // System panels (always shown, not extension-managed)
  const systemPanels = [
    { id: 'performance', icon: <Activity size={18} />, label: i18n.t('panels.core.performance') },
    { id: 'extensions', icon: <Puzzle size={18} />, label: i18n.t('panels.core.extensions') },
    {
      id: 'marketplace',
      icon: <ShoppingCart size={18} />,
      label: i18n.t('panels.core.marketplace'),
    },
  ];

  const handlePanelClick = (id: string) => {
    setRightPanelTab(id);
    if (rightSidebarCollapsed) {
      setRightSidebarCollapsed(false);
    }
  };

  const btnClass = (id: string) =>
    `w-10 h-10 mx-1 mb-1 rounded flex items-center justify-center text-lg transition-colors ${
      rightPanelTab === id && !rightSidebarCollapsed
        ? 'bg-xp-blue text-white'
        : 'hover:bg-xp-surface-light'
    }`;

  return (
    <div
      data-tour={dataTour}
      className="flex w-12 flex-col border-l border-xp-border bg-xp-surface"
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

        {/* Separator between core and extension panels */}
        {registeredPanels.length > 0 && <div className="mx-2 my-1 border-t border-xp-border" />}

        {/* Extension-managed panel icons */}
        {registeredPanels.map((panel) => (
          <button
            key={panel.id}
            onClick={() => handlePanelClick(panel.id)}
            className={btnClass(panel.id)}
            title={panel.title}
          >
            {panel.icon}
          </button>
        ))}

        {/* Separator before system panels */}
        <div className="mx-2 my-1 border-t border-xp-border" />

        {/* System panels */}
        {systemPanels.map(({ id, icon, label }) => (
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
        <button
          onClick={() => setLocation('/settings')}
          className="mx-1 mb-1 flex h-10 w-10 items-center justify-center rounded text-lg transition-colors hover:bg-xp-surface-light"
          title={i18n.t('settings.title')}
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
};

export default VerticalExtensionsBar;
