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
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu';
import { emptyTrashWithConfirmation } from '@/lib/trash-empty';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';

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
}

const LeftSidebar = forwardRef<LeftSidebarHandle, LeftSidebarProps>(function LeftSidebar(
  { currentPath, navigateToPath, handleFileClick, handleFileRightClick, handleFileOpen, width },
  ref,
) {
  const { t } = useTranslation();
  const { toast } = useToast();
  // #59: Finder's trash-entry menu — 打开 / 清倒废纸篓…
  const [trashMenu, setTrashMenu] = useState<{ x: number; y: number } | null>(null);

  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      window.dispatchEvent(new CustomEvent('wisp-open-command-palette'));
    },
  }));

  // ─── Extension sidebar tabs ────────────────────────────────────────────
  const [activeExtensionTab, setActiveExtensionTab] = useState<string | null>(null);
  // The single location the whole sidebar may highlight, decided by Quick
  // Access and consumed by later sections so exactly one row ever lights.
  const [activeLocation, setActiveLocation] = useState<string | undefined>(undefined);

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
      role="navigation"
      aria-label={t('sidebar.explorerSidebar')}
      className="wisp-sidebar wisp-no-select flex flex-shrink-0 flex-col border-r border-xp-border"
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
                {t('interface.extensionTabNotAvailable')}
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
              handleFileOpen={handleFileOpen ?? handleFileClick}
              onActiveLocationChange={setActiveLocation}
            />
            <SidebarDrives
              currentPath={currentPath}
              navigateToPath={navigateToPath}
              upstreamMatch={activeLocation}
            />
            <SidebarTags currentPath={currentPath} navigateToPath={navigateToPath} />
          </div>

          {/* Trash — pinned to the sidebar's very bottom, its own row (Finder) */}
          <button
            onClick={() => navigateToPath('wisp://trash')}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setTrashMenu({ x: event.clientX, y: event.clientY });
            }}
            aria-label={t('navigation.trash')}
            title={t('navigation.trash')}
            className={`wisp-sidebar-trash flex w-full flex-shrink-0 items-center text-[13px] transition-colors ${
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

      {/* #59: 清倒废纸篓… off the sidebar trash entry, same channel as the
          trash page toolbar */}
      <ContextMenu
        isOpen={trashMenu !== null}
        x={trashMenu?.x ?? 0}
        y={trashMenu?.y ?? 0}
        items={[
          {
            id: 'trash-open',
            label: t('contextMenu.open'),
            action: () => navigateToPath('wisp://trash'),
          },
          { id: 'trash-sep', label: '', separator: true },
          {
            id: 'trash-empty',
            label: t('contextMenu.emptyTrash'),
            danger: true,
            action: () => {
              void emptyTrashWithConfirmation({ t, toast });
            },
          },
        ] satisfies ContextMenuItem[]}
        onClose={() => setTrashMenu(null)}
      />
    </nav>
  );
});

export default LeftSidebar;
