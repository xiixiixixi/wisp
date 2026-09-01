import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConflictInfo } from '@/lib/tauri-api';
import type { ConflictPolicy } from '@/lib/drag-transfer';

interface ConflictResolutionDialogProps {
  conflicts: ConflictInfo[];
  onResolve: (policies: Map<string, ConflictPolicy>) => void;
  onCancel: () => void;
}

const POLICIES: ConflictPolicy[] = ['overwrite', 'skip', 'keepBoth', 'merge'];

const POLICY_LABEL_KEY: Record<ConflictPolicy, string> = {
  overwrite: 'conflict.overwrite',
  skip: 'conflict.skip',
  keepBoth: 'conflict.keepBoth',
  merge: 'conflict.merge',
};

const btnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  fontSize: '11px',
  borderRadius: '5px',
  border: `1px solid ${active ? 'var(--xp-blue)' : 'var(--xp-border)'}`,
  background: active ? 'var(--xp-blue)' : 'transparent',
  color: active ? '#fff' : 'var(--xp-text)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

/**
 * Dialog shown when a drop collides with existing files. Offers per-item
 * policies (overwrite / skip / keep both / merge folders) plus apply-to-all.
 */
export const ConflictResolutionDialog = ({
  conflicts,
  onResolve,
  onCancel,
}: ConflictResolutionDialogProps) => {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<Map<string, ConflictPolicy>>(
    () => new Map(conflicts.map((c) => [c.source.path, 'keepBoth'] as const)),
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const setChoice = (path: string, policy: ConflictPolicy) => {
    setChoices((prev) => new Map(prev).set(path, policy));
  };

  const applyToAll = (policy: ConflictPolicy) => {
    setChoices(new Map(conflicts.map((c) => [c.source.path, policy])));
  };

  const isFolderConflict = (c: ConflictInfo) => c.source.is_dir && c.destination.is_dir;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-label={t('conflict.title')}
        style={{
          width: '640px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--xp-surface)',
          border: '1px solid var(--xp-border)',
          borderRadius: '8px',
          boxShadow: 'var(--xp-shadow-popover)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--xp-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#b39a5d"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--xp-text)' }}>
              {t('conflict.title')}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--xp-text-muted)' }}>
              {conflicts.length}
            </span>
          </div>
        </div>

        {/* Apply to all */}
        <div
          style={{
            padding: '10px 20px',
            borderBottom: '1px solid var(--xp-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '12px', color: 'var(--xp-text-muted)' }}>
            {t('conflict.applyToAll')}
          </span>
          {POLICIES.map((policy) => (
            <button
              key={policy}
              type="button"
              style={btnStyle(false)}
              onClick={() => applyToAll(policy)}
            >
              {t(POLICY_LABEL_KEY[policy])}
            </button>
          ))}
        </div>

        {/* Conflict list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
          {conflicts.map((c) => {
            const choice = choices.get(c.source.path) ?? 'keepBoth';
            return (
              <div
                key={c.source.path}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--xp-border)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      color: 'var(--xp-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.source.is_dir ? '📁' : '📄'} {c.source.name}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--xp-text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    → {c.destination.name}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {POLICIES.map((policy) => (
                    <button
                      key={policy}
                      type="button"
                      disabled={policy === 'merge' && !isFolderConflict(c)}
                      style={{
                        ...btnStyle(choice === policy),
                        opacity: policy === 'merge' && !isFolderConflict(c) ? 0.35 : 1,
                      }}
                      onClick={() => setChoice(c.source.path, policy)}
                    >
                      {t(POLICY_LABEL_KEY[policy])}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--xp-border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
          }}
        >
          <button
            type="button"
            style={{
              ...btnStyle(false),
              padding: '7px 16px',
              fontSize: '12px',
            }}
            onClick={onCancel}
          >
            {t('conflict.cancel')}
          </button>
          <button
            type="button"
            style={{
              ...btnStyle(true),
              padding: '7px 16px',
              fontSize: '12px',
              fontWeight: 600,
            }}
            onClick={() => onResolve(choices)}
          >
            {t('conflict.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
