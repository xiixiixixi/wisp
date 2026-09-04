import React, {
  useState,
  useMemo,
  useImperativeHandle,
  forwardRef,
  useSyncExternalStore,
} from 'react';
import { FileEntry } from '@/lib/tauri-api';
import { extensionHost } from '@/lib/extension-host';
import SidebarTabBar from '@/components/explorer/sidebar/SidebarTabBar';
import SidebarQuickAccess from '@/components/explorer/sidebar/SidebarQuickAccess';
import SidebarDrives from '@/components/explorer/sidebar/SidebarDrives';
import SidebarTags from '@/components/explorer/sidebar/SidebarTags';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface LeftSidebarHandle {
  focusSearch: () => void;
}

interface LeftSidebarProps {
  currentPath: string;
  navigateToPath: (path: string) => void;
  handleFileClick: (file: FileEntry) => void;
  handleFileRightClick?: (file: FileEntry, event: React.MouseEvent) => void;
  handleFileOpen?: (file: FileEntry) => void;
  width?: number;
  searchPanelOpen?: boolean;
  onToggleSearchPanel?: () => void;
  'data-tour'?: string;
}

const LeftSidebar = forwardRef<LeftSidebarHandle, LeftSidebarProps>(function LeftSidebar(
  { currentPath, navigateToPath, handleFileRightClick, width, 'data-tour': dataTour },
  ref,
) {
  const { t } = useTranslation();

  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      window.dispatchEvent(new CustomEvent('wisp-open-command-palette'));
    },
  }));

  // ─── Extension sidebar tabs ────────────────────────────────────────────
  const [activeExtensionTab, setActiveExtensionTab] = useState<string | null>(null);

  const extRefreshKey = useSyncExternalStore(
    extensionHost.subscribe,
    extensionHost.getSnapshotVersion,
  );

  const extensionSidebarTabs = useMemo(() => {
    try {
      return extensionHost.getSidebarTabs();
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extRefreshKey]);

  const activeTabId = activeExtensionTab ?? '__explorer__';

  const handleTabClick = (tabId: string) => {
    if (tabId === '__explorer__') {
      setActiveExtensionTab(null);
    } else {
      setActiveExtensionTab(tabId);
    }
  };

  return (
    <nav
      data-tour={dataTour}
      role="navigation"
      aria-label={t('sidebar.explorerSidebar')}
      className="wisp-sidebar wisp-no-select flex flex-shrink-0 flex-col border-r border-xp-border bg-xp-surface"
      style={{ width: width ?? 256, minHeight: 0, overflow: 'hidden' }}
    >
      {/* The tab strip only earns space when an extension contributes a tab. */}
      {extensionSidebarTabs.length > 0 && (
        <SidebarTabBar
          activeTabId={activeTabId}
          onTabClick={handleTabClick}
          extensionTabs={extensionSidebarTabs}
        />
      )}

      {/* Extension sidebar tab content */}
      {activeExtensionTab &&
        (() => {
          const renderer = extensionHost.getSidebarTabRenderer(activeExtensionTab);
          if (!renderer) {
            return (
              <div className="flex flex-1 items-center justify-center p-4 text-xs text-xp-text-muted">
                Extension tab not available
              </div>
            );
          }
          return renderer({ currentPath, isActive: true });
        })()}

      {/* Explorer content (default) */}
      {activeTabId === '__explorer__' && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SidebarQuickAccess
              currentPath={currentPath}
              navigateToPath={navigateToPath}
              handleFileRightClick={handleFileRightClick}
            />
            <SidebarDrives navigateToPath={navigateToPath} />
            <SidebarTags currentPath={currentPath} navigateToPath={navigateToPath} />
          </div>

          {/* Trash — pinned to the sidebar's very bottom, its own row (Finder) */}
          <button
            onClick={() => navigateToPath('wisp://trash')}
            aria-label={t('navigation.trash')}
            title={t('navigation.trash')}
            className={`wisp-sidebar-trash flex w-full flex-shrink-0 items-center border-t border-xp-border px-5 py-2.5 text-xs transition-colors ${
              currentPath === 'wisp://trash'
                ? 'bg-xp-blue/15 text-xp-blue'
                : 'text-xp-text hover:bg-xp-surface-light'
            }`}
          >
            <Trash2
              size={15}
              className="mr-2.5 flex-shrink-0 text-xp-text-secondary"
              aria-hidden="true"
            />
            {t('navigation.trash')}
          </button>
        </>
      )}
    </nav>
  );
});

export default LeftSidebar;
