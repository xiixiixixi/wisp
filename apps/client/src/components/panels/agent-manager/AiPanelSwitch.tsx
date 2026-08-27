/**
 * Segmented switch between the two AI sub-panels (chat / agent manager)
 * rendered at the top of the unified AI sidebar. Dumb component — labels
 * come via props so it stays trivially testable.
 */
import type { CSSProperties } from 'react';

export type AiSubTab = 'chat' | 'agent-manager';

export interface AiPanelSwitchProps {
  active: AiSubTab;
  onChange: (tab: AiSubTab) => void;
  labels: { chat: string; tasks: string };
}

const wrapperStyle: CSSProperties = {
  display: 'flex',
  gap: '4px',
  padding: '6px 8px 0 8px',
  flexShrink: 0,
};

const baseTabStyle: CSSProperties = {
  flex: 1,
  padding: '4px 0',
  fontSize: '11px',
  textAlign: 'center',
  borderRadius: '6px',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'all 0.15s',
};

const activeStyle: CSSProperties = {
  ...baseTabStyle,
  background: 'var(--xp-surface-light)',
  color: 'var(--xp-blue)',
  borderColor: 'var(--xp-border)',
  fontWeight: 600,
};

const inactiveStyle: CSSProperties = {
  ...baseTabStyle,
  color: 'var(--xp-text-muted)',
};

const tabButton = (
  key: AiSubTab,
  label: string,
  isActive: boolean,
  onChange: (tab: AiSubTab) => void,
) => (
  <button
    key={key}
    type="button"
    data-testid={`ai-tab-${key}`}
    aria-pressed={isActive}
    style={isActive ? activeStyle : inactiveStyle}
    onClick={() => {
      if (!isActive) onChange(key);
    }}
  >
    {label}
  </button>
);

const AiPanelSwitch = ({ active, onChange, labels }: AiPanelSwitchProps) => (
  <div style={wrapperStyle} role="tablist" aria-label="AI panel switch">
    {tabButton('chat', labels.chat, active === 'chat', onChange)}
    {tabButton('agent-manager', labels.tasks, active === 'agent-manager', onChange)}
  </div>
);

export default AiPanelSwitch;
