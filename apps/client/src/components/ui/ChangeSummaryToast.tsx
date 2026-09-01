import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { FileChangeSet } from '@/hooks/use-focus-change-tracker';

const AUTO_DISMISS_MS = 30_000; // 30 seconds

interface ChangeSummaryToastProps {
  changes: FileChangeSet;
  onDismiss: () => void;
  onReview: () => void;
}

const ChangeSummaryToast = React.memo(
  ({ changes, onDismiss, onReview }: ChangeSummaryToastProps) => {
    const [visible, setVisible] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [interacted, setInteracted] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Animate in on mount
    useEffect(() => {
      const t = setTimeout(() => setVisible(true), 20);
      return () => clearTimeout(t);
    }, []);

    // Auto-dismiss after 30 seconds if not interacted
    useEffect(() => {
      if (interacted) return;
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setTimeout(onDismiss, 300);
      }, AUTO_DISMISS_MS);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, [interacted, onDismiss]);

    const handleDismiss = useCallback(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, [onDismiss]);

    const handleReview = useCallback(() => {
      setInteracted(true);
      setVisible(false);
      setTimeout(onReview, 300);
    }, [onReview]);

    const handleExpand = useCallback(() => {
      setInteracted(true);
      setExpanded((prev) => !prev);
    }, []);

    const containerStyle: React.CSSProperties = {
      position: 'fixed',
      bottom: 40,
      right: 16,
      zIndex: 9999,
      minWidth: 320,
      maxWidth: 420,
      background: 'var(--xp-surface)',
      border: '1px solid var(--xp-border)',
      borderRadius: 4,
      boxShadow: '0 0 0 1px var(--xp-border)',
      transform: visible ? 'translateY(0)' : 'translateY(20px)',
      opacity: visible ? 1 : 0,
      transition: 'transform 0.3s ease, opacity 0.3s ease',
      overflow: 'hidden',
    };

    const headerStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 12px',
    };

    const iconStyle: React.CSSProperties = {
      width: 18,
      height: 18,
      color: 'var(--xp-blue)',
      flexShrink: 0,
    };

    const titleStyle: React.CSSProperties = {
      flex: 1,
      fontSize: 12,
      fontWeight: 500,
      color: 'var(--xp-text)',
    };

    const subtitleStyle: React.CSSProperties = {
      fontSize: 11,
      color: 'var(--xp-text-muted)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 12px 8px 38px',
    };

    const countStyle = (color: string): React.CSSProperties => ({
      fontSize: 11,
      fontWeight: 500,
      color,
    });

    const buttonRowStyle: React.CSSProperties = {
      display: 'flex',
      gap: 6,
      padding: '0 12px 10px 38px',
    };

    const btnBase: React.CSSProperties = {
      padding: '4px 12px',
      fontSize: 11,
      fontWeight: 500,
      borderRadius: 4,
      border: 'none',
      cursor: 'pointer',
      transition: 'background 0.15s ease',
    };

    const reviewBtnStyle: React.CSSProperties = {
      ...btnBase,
      background: 'var(--xp-blue)',
      color: 'var(--xp-bg)',
    };

    const expandBtnStyle: React.CSSProperties = {
      ...btnBase,
      background: 'var(--xp-surface-light)',
      color: 'var(--xp-text-muted)',
    };

    const dismissBtnStyle: React.CSSProperties = {
      ...btnBase,
      background: 'transparent',
      color: 'var(--xp-text-muted)',
    };

    const listStyle: React.CSSProperties = {
      maxHeight: 180,
      overflowY: 'auto',
      borderTop: '1px solid var(--xp-border)',
      padding: '6px 0',
    };

    const listItemStyle = (_color: string): React.CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 12px',
      fontSize: 11,
      color: 'var(--xp-text)',
    });

    const typeIndicatorStyle = (color: string): React.CSSProperties => ({
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    });

    const allChanges = [
      ...changes.added.map((c) => ({ ...c, color: 'var(--xp-green)' })),
      ...changes.removed.map((c) => ({ ...c, color: 'var(--xp-red)' })),
      ...changes.modified.map((c) => ({ ...c, color: 'var(--xp-orange)' })),
    ];

    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          {/* Bell/change icon */}
          <svg
            style={iconStyle}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          <span style={titleStyle}>
            {changes.totalCount} file{changes.totalCount !== 1 ? 's' : ''} changed while you were
            away
          </span>
        </div>

        <div style={subtitleStyle}>
          {changes.added.length > 0 && (
            <span style={countStyle('var(--xp-green)')}>+{changes.added.length} new</span>
          )}
          {changes.removed.length > 0 && (
            <span style={countStyle('var(--xp-red)')}>-{changes.removed.length} deleted</span>
          )}
          {changes.modified.length > 0 && (
            <span style={countStyle('var(--xp-orange)')}>~{changes.modified.length} modified</span>
          )}
        </div>

        <div style={buttonRowStyle}>
          <button style={reviewBtnStyle} onClick={handleReview}>
            Review
          </button>
          <button style={expandBtnStyle} onClick={handleExpand}>
            {expanded ? 'Collapse' : 'Details'}
          </button>
          <button style={dismissBtnStyle} onClick={handleDismiss}>
            Dismiss
          </button>
        </div>

        {expanded && (
          <div style={listStyle}>
            {allChanges.map((change) => (
              <div key={change.path} style={listItemStyle(change.color)}>
                <div style={typeIndicatorStyle(change.color)} />
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {change.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--xp-text-muted)' }}>{change.type}</span>
              </div>
            ))}
          </div>
        )}

        {/* Auto-dismiss countdown (pauses once the user interacts/expands) */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: 3,
            width: '100%',
            background: 'var(--xp-blue)',
            opacity: interacted ? 0.35 : 1,
            animation: `toast-countdown ${AUTO_DISMISS_MS}ms linear forwards`,
            animationPlayState: interacted ? 'paused' : 'running',
          }}
          aria-hidden="true"
        />
      </div>
    );
  },
);
ChangeSummaryToast.displayName = 'ChangeSummaryToast';

export default ChangeSummaryToast;
