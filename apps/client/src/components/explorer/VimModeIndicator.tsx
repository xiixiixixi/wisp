import React, { useState, useEffect, useRef } from 'react';
import type { VimMode } from '@/hooks/use-vim-mode';

// ── Mode color mapping ───────────────────────────────────────────────────────

const MODE_COLORS: Record<VimMode, string> = {
  normal: 'var(--xp-blue)',
  insert: 'var(--xp-green)',
  visual: 'var(--xp-purple)',
  command: 'var(--xp-yellow)',
};

const MODE_LABELS: Record<VimMode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  command: 'COMMAND',
};

// ── Learning mode hints per mode ─────────────────────────────────────────────

const MODE_HINTS: Record<VimMode, string> = {
  normal: 'h/j/k/l=move  dd=delete  yy=yank  p=paste  /=search  :=command',
  insert: 'Esc=return to normal',
  visual: 'v=toggle  y=yank  d=delete  j/k=extend',
  command: ':w=save  :q=close  :e=edit',
};

// ── Props ────────────────────────────────────────────────────────────────────

interface VimModeIndicatorProps {
  mode: VimMode;
  pendingKeys: string;
  learningMode: boolean;
}

// ── Keyframe animation style (injected once) ────────────────────────────────
// Paper feedback: a quiet opacity dip — no glow rings.

const PULSE_KEYFRAMES = `
@keyframes vim-mode-pulse {
  0% { opacity: 1; }
  50% { opacity: 0.6; }
  100% { opacity: 1; }
}
`;

let styleInjected = false;
const ensurePulseStyle = () => {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = PULSE_KEYFRAMES;
  document.head.appendChild(style);
};

// ── Component ────────────────────────────────────────────────────────────────

const VimModeIndicator = React.memo(
  ({ mode, pendingKeys, learningMode }: VimModeIndicatorProps) => {
    const [isPulsing, setIsPulsing] = useState(false);
    const prevModeRef = useRef<VimMode>(mode);

    // Inject pulse keyframes on mount
    useEffect(() => {
      ensurePulseStyle();
    }, []);

    // Trigger pulse animation on mode change
    useEffect(() => {
      if (prevModeRef.current !== mode) {
        prevModeRef.current = mode;
        setIsPulsing(true);
        const timer = setTimeout(() => setIsPulsing(false), 300);
        return () => clearTimeout(timer);
      }
    }, [mode]);

    const color = MODE_COLORS[mode];
    const label = MODE_LABELS[mode];

    // Container style — sits inline in the status bar left section
    const containerStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      position: 'relative',
    };

    // Mode badge style
    const badgeStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '1px 8px',
      borderRadius: '3px',
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
      color,
      fontSize: '11px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontWeight: 700,
      lineHeight: '16px',
      letterSpacing: '0.05em',
      whiteSpace: 'nowrap',
      cursor: 'default',
      transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
      animation: isPulsing ? 'vim-mode-pulse 0.3s ease-out' : 'none',
    };

    // Pending keys display
    const pendingStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '1px 5px',
      borderRadius: '3px',
      background: 'var(--xp-surface-light, var(--glass-well))',
      border: '1px solid var(--xp-border, var(--glass-well))',
      color: 'var(--xp-text-muted, #888)',
      fontSize: '11px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
      cursor: 'default',
    };

    // Hints tooltip style (shown below on hover or always when learning mode)
    const hintsStyle: React.CSSProperties = {
      position: 'absolute',
      bottom: '100%',
      left: 0,
      marginBottom: '6px',
      padding: '4px 8px',
      borderRadius: '4px',
      background: 'var(--xp-surface, rgba(20, 20, 40, 0.95))',
      border: '1px solid var(--xp-border, var(--xp-border))',
      color: 'var(--xp-text-muted, #aaa)',
      fontSize: '10px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      lineHeight: '14px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 50,
      boxShadow: '0 0 0 1px var(--xp-border), 0 4px 12px rgb(var(--xp-accent-rgb) / 0.08)',
    };

    // The square ink mark before the mode label
    const dotStyle: React.CSSProperties = {
      width: '6px',
      height: '6px',
      borderRadius: '2px',
      background: color,
      flexShrink: 0,
    };

    return (
      <div style={containerStyle} title={`Vim mode: ${label}`}>
        {/* Learning mode hints (shown above) */}
        {learningMode && (
          <div style={hintsStyle} aria-hidden="true">
            {MODE_HINTS[mode]}
          </div>
        )}

        {/* Mode badge */}
        <span style={badgeStyle} role="status" aria-label={`Vim mode: ${label}`} aria-live="polite">
          <span style={dotStyle} aria-hidden="true" />
          {label}
        </span>

        {/* Pending key sequence */}
        {pendingKeys && (
          <span
            style={pendingStyle}
            title={`Pending keys: ${pendingKeys}_`}
            aria-label={`Pending key sequence: ${pendingKeys}`}
          >
            {pendingKeys}_
          </span>
        )}
      </div>
    );
  },
);

export default VimModeIndicator;
