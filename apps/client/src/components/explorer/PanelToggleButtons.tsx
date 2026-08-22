import React from 'react';
import { useTranslation } from 'react-i18next';

interface PanelToggleButtonsProps {
  rightSidebarCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  onToggleRightSidebar: () => void;
  onToggleBottomPanel: () => void;
}

const PanelToggleButtons = React.memo(
  ({
    rightSidebarCollapsed,
    bottomPanelCollapsed,
    onToggleRightSidebar,
    onToggleBottomPanel,
  }: PanelToggleButtonsProps) => {
    const { t } = useTranslation();
    return (
      <div className="absolute bottom-4 right-4 space-y-2">
        {rightSidebarCollapsed && (
          <button
            onClick={onToggleRightSidebar}
            className="xp-panel-toggle rounded border border-xp-border bg-xp-surface p-2 shadow hover:bg-xp-surface-light"
            title={t('panelToggles.togglePanel')}
            aria-label={t('panelToggles.togglePanel')}
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        {bottomPanelCollapsed && (
          <button
            data-tour="bottom-panel-toggle"
            onClick={onToggleBottomPanel}
            className="xp-panel-toggle rounded border border-xp-border bg-xp-surface p-2 shadow hover:bg-xp-surface-light"
            title={t('panelToggles.toggleTerminal')}
            aria-label={t('panelToggles.toggleTerminal')}
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    );
  },
);

export default PanelToggleButtons;
