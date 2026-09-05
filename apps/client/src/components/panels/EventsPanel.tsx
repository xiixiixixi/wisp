import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityEntry } from '@/hooks/use-activity-feed';
import type { AppNotification } from '@/hooks/use-notification-history';
import type { FileChangeSet } from '@/hooks/use-focus-change-tracker';
import ChangeReviewPanel from './ChangeReviewPanel';

const UndoHistoryPanel = React.lazy(() => import('./UndoHistoryPanel'));

export type EventsFilter = 'all' | 'files' | 'notices' | 'undo';

interface EventsPanelProps {
  filter: EventsFilter;
  entries: ActivityEntry[];
  notifications: AppNotification[];
  fileChanges: FileChangeSet | null;
  onDismissChanges: () => void;
  onNavigate?: (path: string) => void;
}

const relativeTime = (ts: number): string => {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const activityVerb: Record<ActivityEntry['type'], string> = {
  created: 'eventsPanel.created',
  modified: 'eventsPanel.modified',
  deleted: 'eventsPanel.deleted',
  renamed: 'eventsPanel.renamed',
};

const noticeColor: Record<AppNotification['type'], string> = {
  success: 'text-xp-green',
  error: 'text-xp-red',
  warning: 'text-xp-yellow',
  info: 'text-xp-blue',
};

const parentDirectory = (path: string): string => {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : normalized;
};

/**
 * 动态 — one quiet feed for everything that happened around you: the
 * away-time directory digest first, then file events and app notices in a
 * single timeline, with your own undoable operations in their section.
 * Presentational: filters and actions live in the bottom tabbar row.
 */
const EventsPanel = ({
  filter,
  entries,
  notifications,
  fileChanges,
  onDismissChanges,
  onNavigate,
}: EventsPanelProps) => {
  const { t } = useTranslation();

  const timeline = useMemo(() => {
    const items: Array<
      | { kind: 'file'; ts: number; entry: ActivityEntry }
      | { kind: 'notice'; ts: number; entry: AppNotification }
    > = [];
    if (filter === 'all' || filter === 'files') {
      for (const entry of entries) items.push({ kind: 'file', ts: entry.timestamp, entry });
    }
    if (filter === 'all' || filter === 'notices') {
      for (const entry of notifications) items.push({ kind: 'notice', ts: entry.timestamp, entry });
    }
    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, 120);
  }, [entries, notifications, filter]);

  const showDigest =
    fileChanges && fileChanges.totalCount > 0 && (filter === 'all' || filter === 'files');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Away-time digest — the report that earned the top slot */}
      {showDigest && (
        <ChangeReviewPanel
          changes={fileChanges}
          onDismiss={onDismissChanges}
          onNavigate={onNavigate}
        />
      )}

      {/* Undo section — your own operations */}
      {filter === 'undo' && (
        <React.Suspense
          fallback={
            <div className="flex h-16 items-center justify-center text-xs text-xp-text-muted">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </div>
          }
        >
          <UndoHistoryPanel />
        </React.Suspense>
      )}

      {/* Merged timeline — file events and notices, newest first */}
      {filter !== 'undo' && (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {timeline.length === 0 && !showDigest && (
            <div className="flex h-16 items-center justify-center text-xs text-xp-text-muted">
              {t('eventsPanel.empty')}
            </div>
          )}
          {timeline.map((item) =>
            item.kind === 'file' ? (
              <button
                key={`file-${item.entry.id}`}
                onClick={() => onNavigate?.(parentDirectory(item.entry.path))}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-xp-surface-light/60"
              >
                <span className="w-3 flex-shrink-0 text-center font-mono text-[10px] text-xp-text-muted">
                  {item.entry.type === 'created'
                    ? '+'
                    : item.entry.type === 'deleted'
                      ? '−'
                      : item.entry.type === 'renamed'
                        ? '→'
                        : '~'}
                </span>
                <span className="truncate">{item.entry.name}</span>
                <span className="truncate text-[10px] text-xp-text-muted">
                  {t(activityVerb[item.entry.type])}
                </span>
                <span className="ml-auto flex-shrink-0 text-[10px] text-xp-text-muted">
                  {relativeTime(item.ts)}
                </span>
              </button>
            ) : (
              <div
                key={`notice-${item.entry.id}`}
                className="flex w-full items-center gap-2 px-3 py-1 text-xs"
              >
                <span
                  className={`w-3 flex-shrink-0 text-center text-[10px] ${noticeColor[item.entry.type]}`}
                >
                  •
                </span>
                <span
                  className={`truncate ${item.entry.read ? 'text-xp-text-muted' : 'font-medium'}`}
                >
                  {item.entry.title}
                </span>
                <span className="ml-auto flex-shrink-0 text-[10px] text-xp-text-muted">
                  {relativeTime(item.ts)}
                </span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
};

export default EventsPanel;
