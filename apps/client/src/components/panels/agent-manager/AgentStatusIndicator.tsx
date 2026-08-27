/**
 * AgentStatusIndicator — a small overlay badge for the Agent Manager icon
 * in VerticalExtensionsBar. Shows count of active agents plus a pulsing
 * dot when any agent is currently running.
 *
 * Reads the shared external-agent registry directly so the badge stays accurate
 * even while the Agent panel itself is closed.
 *
 * Usage: wrap the Bot icon in VerticalExtensionsBar with this component.
 */
import { useSyncExternalStore } from 'react';
import { getExternalAgentsSnapshot, subscribeToExternalAgents } from './external-agent-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentStatusIndicatorProps {
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentStatusIndicator = ({ children }: AgentStatusIndicatorProps) => {
  const agents = useSyncExternalStore(
    subscribeToExternalAgents,
    getExternalAgentsSnapshot,
    getExternalAgentsSnapshot,
  );
  const runningCount = agents.filter((agent) => agent.status !== 'exited').length;
  const hasActive = agents.some((agent) => agent.status === 'active');

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {children}

      {/* Count badge — only shown when agents are active */}
      {runningCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: '14px',
            height: '14px',
            borderRadius: '7px',
            background: 'var(--xp-green, #73daca)',
            color: '#fff',
            fontSize: '9px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            lineHeight: 1,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {runningCount}
        </span>
      )}

      {/* Pulsing dot — indicates activity */}
      {hasActive && (
        <span
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--xp-green, #73daca)',
            boxShadow: '0 0 4px var(--xp-green, #73daca)',
            animation: 'pulse 2s infinite',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
};

export default AgentStatusIndicator;
