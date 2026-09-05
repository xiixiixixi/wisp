import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal as TerminalIcon, CheckCheck, Trash2 } from 'lucide-react';

// Lazy-loaded sub-panels -- only loaded when the user switches to their tab
const XTermPanel = React.lazy(() => import('./XTermPanel'));
const EventsPanel = React.lazy(() => import('./EventsPanel'));
const ClipboardHistoryPanel = React.lazy(() => import('./ClipboardHistoryPanel'));
const PropertiesPanel = React.lazy(() => import('./PropertiesPanel'));
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useNotificationHistory } from '@/hooks/use-notification-history';
import { useActivityFeed } from '@/hooks/use-activity-feed';
import {
  getHistory as getClipboardHistory,
  type ClipboardEntry,
} from '@/hooks/use-clipboard-history';
import type { FileChangeSet } from '@/hooks/use-focus-change-tracker';
import type { BottomPanelTabId } from '@/hooks/use-layout-state';
import { formatKeyComboForDisplay } from '@/lib/shortcut-utils';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { extensionHost } from '@/lib/extension-host';
import { CLI_AGENT_LAUNCHED_EVENT } from './agent-manager/cli-launch-bus';

type BottomPanelTab = BottomPanelTabId;

type EventsFilter = 'all' | 'files' | 'notices' | 'undo';

interface BottomPanelProps {
  bottomPanelCollapsed: boolean;
  setBottomPanelCollapsed: (collapsed: boolean) => void;
  bottomPanelTab: BottomPanelTab;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  height?: number;
  terminalCwd: string;
  currentPath: string;
  onNavigate?: (path: string) => void;
  onPasteFromHistory?: (entry: ClipboardEntry) => void;
  fileChanges?: FileChangeSet | null;
  onDismissChanges?: () => void;
  propertiesFilePath?: string;
}

/** Core (built-in) bottom panel tab IDs */
const CORE_TABS: BottomPanelTab[] = ['terminal', 'events', 'clipboard', 'properties'];

const BottomPanel = ({
  bottomPanelCollapsed,
  setBottomPanelCollapsed,
  bottomPanelTab,
  setBottomPanelTab,
  height,
  terminalCwd,
  currentPath,
  onNavigate,
  onPasteFromHistory,
  fileChanges,
  onDismissChanges,
  propertiesFilePath,
}: BottomPanelProps) => {
  const { t } = useTranslation();
  const {
    unreadCount,
    notifications,
    markAllAsRead,
    clearAll: clearNotifications,
  } = useNotificationHistory();
  const { entries, clearFeed } = useActivityFeed();
  const [eventsFilter, setEventsFilter] = useState<EventsFilter>('all');

  // 空的动态面板不配占三分之一窗口：无内容时只剩标签行（32px），
  // 有任务（条目/通知/待审变更）出现时自动回到记忆高度。
  const eventsEmpty =
    entries.length === 0 && notifications.length === 0 && !fileChanges?.totalCount;
  const compactEventsRow = bottomPanelTab === 'events' && eventsEmpty;

  // 剪贴板/属性的空态也不配占完整抽屉（ChatGPT R4 评审：空态 150–170px，
  // 有内容时回到记忆高度；属性带文件时钳制在 180–300px 的检查器区间）。
  const [clipboardEmpty, setClipboardEmpty] = useState(getClipboardHistory().length === 0);
  useEffect(() => {
    const refresh = () => setClipboardEmpty(getClipboardHistory().length === 0);
    refresh();
    window.addEventListener('clipboard-history-changed', refresh);
    return () => window.removeEventListener('clipboard-history-changed', refresh);
  }, []);
  const propertiesEmpty = !propertiesFilePath;
  const drawerHeight = (() => {
    const persisted = height ?? 148;
    if (bottomPanelTab === 'clipboard' && clipboardEmpty) return Math.min(persisted, 160);
    if (bottomPanelTab === 'properties') {
      if (propertiesEmpty) return Math.min(persisted, 160);
      return Math.max(180, Math.min(persisted, 300));
    }
    return persisted;
  })();

  // When a CLI agent launches, expand this panel and switch to the terminal
  // tab so the attached session is immediately visible.
  useEffect(() => {
    const onLaunched = () => {
      setBottomPanelCollapsed(false);
      setBottomPanelTab('terminal');
    };
    window.addEventListener(CLI_AGENT_LAUNCHED_EVENT, onLaunched);
    return () => {
      window.removeEventListener(CLI_AGENT_LAUNCHED_EVENT, onLaunched);
    };
  }, [setBottomPanelCollapsed, setBottomPanelTab]);

  // Collect extension-registered bottom tabs, re-evaluate when extensions change
  const extRefreshKey = useSyncExternalStore(
    extensionHost.subscribe,
    extensionHost.getSnapshotVersion,
  );

  const extensionBottomTabs = useMemo(() => {
    try {
      return extensionHost.getBottomTabs();
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extRefreshKey]);

  // Listen for wisp-set-bottom-tab events (dispatched by extensions/commands)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) {
        setBottomPanelTab(detail.tab as BottomPanelTab);
      }
    };
    window.addEventListener('wisp-set-bottom-tab', handler);
    return () => window.removeEventListener('wisp-set-bottom-tab', handler);
  }, [setBottomPanelTab]);

  // Check if the active tab is an extension tab
  const isExtensionTab = !CORE_TABS.includes(bottomPanelTab);

  const coreTabLabelKeys: Record<string, string> = {
    terminal: 'bottomPanel.terminal',
    events: 'bottomPanel.events',
    clipboard: 'bottomPanel.clipboard',
    properties: 'bottomPanel.properties',
  };

  const getTabLabel = (tab: BottomPanelTab): string => {
    if (tab === 'properties' && propertiesFilePath) {
      return `${t('bottomPanel.properties')}: ${propertiesFilePath.replace(/^.*[\\/]/, '')}`;
    }
    // Extension tab label (not translated -- provided by extension)
    const extTab = extensionBottomTabs.find((bt) => bt.id === tab);
    if (extTab) return extTab.title;
    // Use i18n key for core tabs
    const key = coreTabLabelKeys[tab];
    if (key) return t(key);
    // Fallback to title case
    return tab.charAt(0).toUpperCase() + tab.slice(1);
  };

  return (
    <div
      // Collapsed hides the same tree instead of unmounting it, so terminal
      // sessions (and any other panel state) survive collapse/expand.
      className={`wisp-bottom-panel ${bottomPanelCollapsed || compactEventsRow ? 'hidden' : 'flex flex-shrink-0 flex-col border-t border-xp-border bg-xp-surface'}`}
      style={{ height: compactEventsRow ? undefined : drawerHeight }}
    >
      {/* Bottom Panel Tabs */}
      <div
        className="wisp-bottom-tabbar wisp-no-select flex items-center border-b border-xp-border"
        role="tablist"
        aria-label="Bottom panel tabs"
      >
        {/* Core tabs */}
        {CORE_TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={bottomPanelTab === tab}
            aria-controls={`bottom-panel-${tab}`}
            id={`bottom-tab-${tab}`}
            onClick={() => setBottomPanelTab(tab)}
            className={`wisp-bottom-tab flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium ${
              bottomPanelTab === tab ? 'text-xp-blue' : 'text-xp-text-secondary hover:text-xp-text'
            }`}
          >
            {getTabLabel(tab)}
            {tab === 'events' && fileChanges && fileChanges.totalCount > 0 && (
              <span className="ml-0.5 rounded-[2px] bg-xp-yellow/20 px-1 text-[10px] font-medium text-xp-yellow">
                {fileChanges.totalCount}
              </span>
            )}
            {tab === 'events' && unreadCount > 0 && (
              <span className="ml-0.5 rounded-[2px] bg-xp-blue/20 px-1 text-[10px] font-medium text-xp-blue">
                {unreadCount}
              </span>
            )}
          </button>
        ))}

        {/* Extension-provided bottom tabs */}
        {extensionBottomTabs.map((extTab) => (
          <button
            key={extTab.id}
            role="tab"
            aria-selected={bottomPanelTab === extTab.id}
            aria-controls={`bottom-panel-${extTab.id}`}
            id={`bottom-tab-${extTab.id}`}
            onClick={() => setBottomPanelTab(extTab.id as BottomPanelTab)}
            className={`wisp-bottom-tab flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium ${
              bottomPanelTab === extTab.id
                ? 'text-xp-blue'
                : 'text-xp-text-secondary hover:text-xp-text'
            }`}
          >
            {extTab.icon && <span className="h-3.5 w-3.5">{extTab.icon}</span>}
            {extTab.title}
          </button>
        ))}

        {/* 动态过滤器与操作直接住在标签行里 —— 底部只有一条 32px 的栏 */}
        {bottomPanelTab === 'events' && (
          <div className="ml-auto flex items-center gap-1">
            {(
              [
                ['all', 'eventsPanel.filterAll'],
                ['files', 'eventsPanel.filterFiles'],
                ['notices', 'eventsPanel.filterNotices'],
                ['undo', 'eventsPanel.filterUndo'],
              ] as const
            ).map(([value, key]) => (
              <button
                key={value}
                onClick={() => setEventsFilter(value)}
                className={`rounded-[2px] px-2 py-0.5 text-[10px] font-medium ${
                  eventsFilter === value
                    ? 'bg-xp-blue/20 text-xp-blue'
                    : 'text-xp-text-muted hover:bg-xp-surface-light'
                }`}
              >
                {t(key)}
              </button>
            ))}
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                title={t('eventsPanel.markAllRead')}
                aria-label={t('eventsPanel.markAllRead')}
                className="flex h-6 w-6 items-center justify-center rounded-[2px] text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              >
                <CheckCheck size={13} />
              </button>
            )}
            {(entries.length > 0 || notifications.length > 0) && (
              <button
                onClick={() => {
                  clearFeed();
                  clearNotifications();
                }}
                title={t('eventsPanel.clearAll')}
                aria-label={t('eventsPanel.clearAll')}
                className="flex h-6 w-6 items-center justify-center rounded-[2px] text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}

        <button
          onClick={() => setBottomPanelCollapsed(true)}
          className={`wisp-bottom-close flex h-7 w-7 items-center justify-center text-xp-text-muted hover:text-xp-text ${
            bottomPanelTab === 'events' ? '' : 'ml-auto'
          }`}
          title={`Close (${formatKeyComboForDisplay('ctrl+j')})`}
          aria-label="Close bottom panel"
        >
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Terminal content: mounted once and only hidden, so switching bottom
          tabs never kills the PTY sessions or loses their scrollback. */}
      <div
        role="tabpanel"
        id="bottom-panel-terminal"
        aria-labelledby="bottom-tab-terminal"
        aria-hidden={bottomPanelTab !== 'terminal'}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ display: bottomPanelTab === 'terminal' ? 'flex' : 'none' }}
      >
        {isBrowserDemoMode() ? (
          <div className="wisp-terminal-demo-state flex h-full items-center justify-center gap-3 px-6 text-left">
            <div className="wisp-terminal-demo-icon flex h-9 w-9 flex-none items-center justify-center">
              <TerminalIcon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-xp-text">
                {t('bottomPanel.terminalDemoTitle')}
              </div>
              <div className="mt-0.5 text-[11px] text-xp-text-muted">
                {t('bottomPanel.terminalDemoDescription')}
              </div>
            </div>
          </div>
        ) : (
          <ErrorBoundary>
            <React.Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-xs text-xp-text-muted">
                  Loading...
                </div>
              }
            >
              <XTermPanel
                cwd={terminalCwd}
                visible={!bottomPanelCollapsed && bottomPanelTab === 'terminal'}
              />
            </React.Suspense>
          </ErrorBoundary>
        )}
      </div>

      {/* Bottom Panel Content (non-terminal tabs) */}
      {bottomPanelTab !== 'terminal' && !compactEventsRow && (
        <div
          role="tabpanel"
          id={`bottom-panel-${bottomPanelTab}`}
          aria-labelledby={`bottom-tab-${bottomPanelTab}`}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <ErrorBoundary>
            {!isExtensionTab && (
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-xs text-xp-text-muted">
                    Loading...
                  </div>
                }
              >
                {bottomPanelTab === 'events' && (
                  <EventsPanel
                    filter={eventsFilter}
                    entries={entries}
                    notifications={notifications}
                    fileChanges={fileChanges ?? null}
                    onDismissChanges={onDismissChanges ?? (() => {})}
                    onNavigate={onNavigate}
                  />
                )}

                {bottomPanelTab === 'clipboard' && onPasteFromHistory && (
                  <ClipboardHistoryPanel onPaste={onPasteFromHistory} />
                )}

                {bottomPanelTab === 'properties' && (
                  <PropertiesPanel filePath={propertiesFilePath ?? ''} />
                )}
              </React.Suspense>
            )}

            {/* Extension tab: sole flex child gets all available height */}
            {isExtensionTab && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {(() => {
                  const renderer = extensionHost.getBottomTabRenderer(bottomPanelTab);
                  if (!renderer) return null;
                  return renderer({ currentPath, isActive: true });
                })()}
              </div>
            )}
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
};

export default BottomPanel;
