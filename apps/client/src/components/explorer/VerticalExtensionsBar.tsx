import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
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
  MoreHorizontal,
} from 'lucide-react';
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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

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
      { id: 'tokenizer', icon: <Search size={18} />, label: t('extensionsBar.contentSearch') },
      { id: 'chat', icon: <MessageSquare size={18} />, label: t('extensionsBar.aiChat') },
      {
        id: 'agent-manager',
        icon: (
          <AgentStatusIndicator>
            <Bot size={18} />
          </AgentStatusIndicator>
        ),
        label: t('extensionsBar.agentManager'),
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
      { id: 'extensions', icon: <Puzzle size={18} />, label: t('extensionsBar.extensions') },
      {
        id: 'marketplace',
        icon: <ShoppingCart size={18} />,
        label: t('extensionsBar.marketplace'),
      },
    ],
    [registeredPanels, t],
  );

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: MouseEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  const handlePanelClick = (id: string) => {
    setRightPanelTab(id);
    if (rightSidebarCollapsed) {
      setRightSidebarCollapsed(false);
    }
  };

  const btnClass = (id: string) =>
    `relative w-10 h-10 mx-1 mb-1 rounded-xl flex items-center justify-center text-lg transition-all ${
      rightPanelTab === id && !rightSidebarCollapsed
        ? 'bg-xp-blue text-white shadow-md shadow-black/15'
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

        {/* Advanced and extension panels stay one click away without crowding the rail. */}
        <div className="mx-2 my-1 border-t border-xp-border" />
        <div ref={moreMenuRef} className="relative">
          <button
            onClick={() => setMoreOpen((open) => !open)}
            className="mx-1 mb-1 flex h-10 w-10 items-center justify-center rounded-xl text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            title={t('extensionsBar.moreTools')}
            aria-label={t('extensionsBar.moreTools')}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal size={18} />
          </button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute right-full top-0 z-[100] mr-2 w-48 rounded-xl border border-xp-border bg-xp-popover p-1.5 shadow-2xl backdrop-blur-xl"
            >
              {advancedPanels.map(({ id, icon, label }) => (
                <button
                  key={id}
                  role="menuitem"
                  onClick={() => {
                    handlePanelClick(id);
                    setMoreOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-xp-surface-light ${
                    rightPanelTab === id && !rightSidebarCollapsed ? 'text-xp-blue' : 'text-xp-text'
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center text-xp-text-secondary">
                    {icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <div className="border-t border-xp-border p-2">
        <Link
          href="/settings"
          className="mx-1 mb-1 flex h-10 w-10 items-center justify-center rounded hover:bg-xp-surface-light"
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
