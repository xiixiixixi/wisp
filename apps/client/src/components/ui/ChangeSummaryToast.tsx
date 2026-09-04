import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileChangeSet } from '@/hooks/use-focus-change-tracker';
import { BottomRightOverlayStackItem } from '@/components/ui/BottomRightOverlayStack';

const AUTO_DISMISS_MS = 30_000; // 30 seconds

interface ChangeSummaryToastProps {
  changes: FileChangeSet;
  onDismiss: () => void;
  onReview: () => void;
}

const ChangeSummaryToast = React.memo(
  ({ changes, onDismiss, onReview }: ChangeSummaryToastProps) => {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [interacted, setInteracted] = useState(false);
    const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exitingRef = useRef(false);

    const beginExit = useCallback((onExited: () => void) => {
      if (exitingRef.current) return;

      exitingRef.current = true;
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
        autoDismissTimerRef.current = null;
      }
      setVisible(false);
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = null;
        onExited();
      }, 300);
    }, []);

    // Animate in on mount
    useEffect(() => {
      const t = setTimeout(() => {
        if (!exitingRef.current) setVisible(true);
      }, 20);
      return () => clearTimeout(t);
    }, []);

    useEffect(
      () => () => {
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      },
      [],
    );

    // Auto-dismiss after 30 seconds if not interacted
    useEffect(() => {
      if (interacted) return;
      autoDismissTimerRef.current = setTimeout(() => beginExit(onDismiss), AUTO_DISMISS_MS);
      return () => {
        if (autoDismissTimerRef.current) {
          clearTimeout(autoDismissTimerRef.current);
          autoDismissTimerRef.current = null;
        }
      };
    }, [beginExit, interacted, onDismiss]);

    const handleDismiss = useCallback(() => {
      beginExit(onDismiss);
    }, [beginExit, onDismiss]);

    const handleReview = useCallback(() => {
      setInteracted(true);
      beginExit(onReview);
    }, [beginExit, onReview]);

    const handleExpand = useCallback(() => {
      setInteracted(true);
      setExpanded((prev) => !prev);
    }, []);

    const containerStyle: React.CSSProperties = {
      position: 'relative',
      width: '100%',
      background: 'var(--xp-surface)',
      border: '1px solid var(--xp-border)',
      borderRadius: 4,
      boxShadow: '0 0 0 1px var(--xp-border)',
      transform: visible ? 'translateY(0)' : 'translateY(20px)',
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none',
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

    const closeButtonStyle: React.CSSProperties = {
      width: 28,
      height: 28,
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 0,
      borderRadius: 2,
      background: 'transparent',
      color: 'var(--xp-text-muted)',
      cursor: 'pointer',
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
      <BottomRightOverlayStackItem>
        <div role="region" aria-label={t('changeSummaryToast.regionLabel')} style={containerStyle}>
          <div style={headerStyle}>
            <Bell style={iconStyle} aria-hidden="true" />
            <span role="status" aria-atomic="true" style={titleStyle}>
              {t(
                changes.totalCount === 1
                  ? 'changeSummaryToast.titleOne'
                  : 'changeSummaryToast.titleOther',
                { count: changes.totalCount },
              )}
            </span>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={t('changeSummaryToast.close')}
              title={t('changeSummaryToast.close')}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xp-blue"
              style={closeButtonStyle}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          <div style={subtitleStyle}>
            {changes.added.length > 0 && (
              <span style={countStyle('var(--xp-green)')}>
                {t('changeSummaryToast.added', { count: changes.added.length })}
              </span>
            )}
            {changes.removed.length > 0 && (
              <span style={countStyle('var(--xp-red)')}>
                {t('changeSummaryToast.removed', { count: changes.removed.length })}
              </span>
            )}
            {changes.modified.length > 0 && (
              <span style={countStyle('var(--xp-orange)')}>
                {t('changeSummaryToast.modified', { count: changes.modified.length })}
              </span>
            )}
          </div>

          <div style={buttonRowStyle}>
            <button type="button" style={reviewBtnStyle} onClick={handleReview}>
              {t('changeSummaryToast.review')}
            </button>
            <button type="button" style={expandBtnStyle} onClick={handleExpand}>
              {t(expanded ? 'changeSummaryToast.collapse' : 'changeSummaryToast.showDetails')}
            </button>
            <button type="button" style={dismissBtnStyle} onClick={handleDismiss}>
              {t('changeSummaryToast.dismiss')}
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
                  <span style={{ fontSize: 10, color: 'var(--xp-text-muted)' }}>
                    {t(`changeSummaryToast.types.${change.type}`)}
                  </span>
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
      </BottomRightOverlayStackItem>
    );
  },
);
ChangeSummaryToast.displayName = 'ChangeSummaryToast';

export default ChangeSummaryToast;
