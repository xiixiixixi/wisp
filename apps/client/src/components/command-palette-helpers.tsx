import React from 'react';
import type { SearchResult, RecentFile } from '@/lib/tauri-api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  icon?: React.ReactNode;
  category?: string;
  action: () => void;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect?: (filePath: string, isDir: boolean) => void;
  currentPath?: string;
}

export type PaletteItem =
  | { type: 'go-to-path'; path: string; sectionLabel?: string }
  | { type: 'recent-file'; file: RecentFile; sectionLabel?: string }
  | { type: 'assistant'; prompt: string; sectionLabel?: string };

/**
 * SearchResult deliberately mirrors the backend search contract, which only
 * describes indexed files.  The command palette also adapts paths returned by
 * `findFiles`, so it carries an explicit directory flag locally instead of
 * guessing from the display name.
 */
export type PaletteSearchResult = SearchResult & { isDir: boolean };

export type VirtualRow =
  | { kind: 'section-header'; label: string }
  | { kind: 'go-to-path'; path: string; itemIndex: number }
  | { kind: 'recent-file'; file: RecentFile; itemIndex: number }
  | { kind: 'search-file'; result: PaletteSearchResult; itemIndex: number }
  | { kind: 'assistant'; prompt: string; itemIndex: number }
  | { kind: 'loading' };

// ── Constants ────────────────────────────────────────────────────────────────

export const COMMAND_ROW_HEIGHT = 40;
export const FILE_ROW_HEIGHT = 50;
export const ASSISTANT_ROW_HEIGHT = 64;
export const SECTION_HEADER_HEIGHT = 28;
export const LOADING_ROW_HEIGHT = 36;

export const formatTimestamp = (ts: number): string => {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

// ── Fuzzy matching ──────────────────────────────────────────────────────────

export const fuzzyMatch = (query: string, target: string): number[] | null => {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const indices: number[] = [];
  let qi = 0;

  for (let ti = 0; ti < lowerTarget.length && qi < lowerQuery.length; ti++) {
    if (lowerTarget[ti] === lowerQuery[qi]) {
      indices.push(ti);
      qi++;
    }
  }

  return qi === lowerQuery.length ? indices : null;
};

export const fuzzyScore = (query: string, target: string, matchIndices: number[]): number => {
  let score = 0;
  const lowerTarget = target.toLowerCase();

  for (let i = 1; i < matchIndices.length; i++) {
    const gap = matchIndices[i] - matchIndices[i - 1] - 1;
    score += gap * 2;
  }

  if (matchIndices.length > 0 && matchIndices[0] === 0) {
    score -= 10;
  }

  for (const idx of matchIndices) {
    if (idx === 0 || lowerTarget[idx - 1] === ' ' || lowerTarget[idx - 1] === ':') {
      score -= 3;
    }
  }

  score += target.length * 0.1;

  return score;
};

// ── Hoisted style objects (created once, never re-allocated) ────────────────

export const highlightStyle: React.CSSProperties = {
  color: 'var(--xp-blue, #45423c)',
  fontWeight: 600,
};

export const sectionHeaderStyle: React.CSSProperties = {
  padding: '10px 16px 4px 16px',
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--xp-text-muted, #6e6a61)',
};

export const itemBaseStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '8px 16px',
  textAlign: 'left',
  fontSize: '14px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'background-color var(--lg-motion-fast), color var(--lg-motion-fast)',
  color: 'var(--xp-text-secondary, #6e6a61)',
};

export const itemSelectedStyle: React.CSSProperties = {
  ...itemBaseStyle,
  background: 'linear-gradient(90deg, var(--xp-selection-bg), transparent 92%)',
  color: 'var(--xp-text, #38352f)',
  boxShadow: 'inset 3px 0 0 var(--xp-blue)',
};

export const iconWrapStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '16px',
  height: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0.7,
};

export const shortcutStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '11px',
  color: 'var(--xp-text-secondary, #6e6a61)',
  fontFamily: 'monospace',
  backgroundColor: 'var(--xp-surface-light)',
  padding: '2px 6px',
  borderRadius: '4px',
  border: '1px solid var(--xp-border)',
};

export const timestampStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '10px',
  color: 'var(--xp-text-muted, #6e6a61)',
};

export const starBtnBaseStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '2px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'opacity 0.15s',
};

export const kbdStyle: React.CSSProperties = {
  padding: '2px 4px',
  color: 'var(--xp-text-secondary, #6e6a61)',
  backgroundColor: 'var(--xp-surface-light)',
  borderRadius: '3px',
  border: '1px solid var(--xp-border)',
  fontSize: '10px',
  fontFamily: 'monospace',
};

export const textEllipsisStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const fileNameContainerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
};

export const fileNameStyle: React.CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const filePathStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '10px',
  color: 'var(--xp-text-muted, #6e6a61)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '11vh',
  backgroundColor: 'rgba(8, 17, 31, 0.24)',
  WebkitBackdropFilter: 'blur(8px) saturate(115%)',
  backdropFilter: 'blur(8px) saturate(115%)',
};

export const dialogStyle: React.CSSProperties = {
  width: 'min(640px, calc(100vw - 32px))',
  maxHeight: '68vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--lg-glass-strong, var(--xp-popover, #f7f5ee))',
  border: '1px solid var(--lg-glass-stroke-strong, var(--xp-border))',
  borderRadius: 'var(--lg-radius-xl, 26px)',
  boxShadow: 'var(--lg-shadow-elevated, var(--xp-shadow-popover))',
  WebkitBackdropFilter: 'saturate(var(--lg-saturate, 175%)) blur(var(--lg-blur-strong, 40px))',
  backdropFilter: 'saturate(var(--lg-saturate, 175%)) blur(var(--lg-blur-strong, 40px))',
  overflow: 'hidden',
};

export const searchBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 18px',
  borderBottom: '1px solid var(--xp-border, rgba(56,53,47,0.14))',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.08), transparent)',
};

export const searchIconStyle: React.CSSProperties = {
  width: '16px',
  height: '16px',
  flexShrink: 0,
  color: 'var(--xp-text-muted, #6e6a61)',
};

export const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: 'var(--xp-text, #38352f)',
  fontSize: '15px',
  outline: 'none',
  border: 'none',
};

export const clearBtnStyle: React.CSSProperties = {
  padding: '2px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--xp-text-muted, #6e6a61)',
};

export const clearIconStyle: React.CSSProperties = {
  width: '14px',
  height: '14px',
};

export const emptyStateStyle: React.CSSProperties = {
  padding: '32px 16px',
  textAlign: 'center',
  color: 'var(--xp-text-muted, #6e6a61)',
  fontSize: '14px',
};

export const loadingContainerStyle: React.CSSProperties = {
  padding: '8px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  color: 'var(--xp-text-muted, #6e6a61)',
  fontSize: '12px',
};

export const loadingSpinnerStyle: React.CSSProperties = {
  width: '12px',
  height: '12px',
  borderRadius: '50%',
  border: '2px solid var(--xp-text-muted, #6e6a61)',
  borderTopColor: 'transparent',
  animation: 'spin 1s linear infinite',
};

export const footerStyle: React.CSSProperties = {
  padding: '9px 18px',
  borderTop: '1px solid var(--xp-border, rgba(56,53,47,0.14))',
  fontSize: '11px',
  color: 'var(--xp-text-muted, #6e6a61)',
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
};

// ── Sub-components ──────────────────────────────────────────────────────────

/** Renders text with matched characters highlighted */
export const HighlightedText = React.memo(
  ({ text, matchIndices }: { text: string; matchIndices: number[] }) => {
    if (matchIndices.length === 0) {
      return <span>{text}</span>;
    }

    const matchSet = new Set(matchIndices);
    const parts: React.ReactNode[] = [];
    let currentRun = '';
    let currentIsMatch = false;

    for (let i = 0; i < text.length; i++) {
      const isMatch = matchSet.has(i);
      if (i === 0) {
        currentIsMatch = isMatch;
        currentRun = text[i];
      } else if (isMatch === currentIsMatch) {
        currentRun += text[i];
      } else {
        parts.push(
          currentIsMatch ? (
            <span key={parts.length} style={highlightStyle}>
              {currentRun}
            </span>
          ) : (
            <span key={parts.length}>{currentRun}</span>
          ),
        );
        currentRun = text[i];
        currentIsMatch = isMatch;
      }
    }

    if (currentRun) {
      parts.push(
        currentIsMatch ? (
          <span key={parts.length} style={highlightStyle}>
            {currentRun}
          </span>
        ) : (
          <span key={parts.length}>{currentRun}</span>
        ),
      );
    }

    return <>{parts}</>;
  },
);
HighlightedText.displayName = 'HighlightedText';

export const StarIcon = React.memo(({ filled, size = 14 }: { filled: boolean; size?: number }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? '#b39a5d' : 'none'}
      stroke={filled ? '#b39a5d' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
});
StarIcon.displayName = 'StarIcon';

export const ClockIcon = React.memo(({ size = 14 }: { size?: number }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
});
ClockIcon.displayName = 'ClockIcon';
