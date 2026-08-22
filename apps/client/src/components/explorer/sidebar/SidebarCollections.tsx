import React, { useState, useEffect } from 'react';
import { Plus, ChevronDown, ChevronRight, GripHorizontal } from 'lucide-react';
import {
  getAllCollections,
  deleteCollection,
  isSmartFolder,
  type FileCollection,
} from '@/lib/collections';
import { renderIcon } from '@/lib/utils';
import { useWindowEvent } from '@/hooks/use-window-event';
import { useTranslation } from 'react-i18next';

interface SidebarCollectionsProps {
  currentPath: string;
  navigateToPath: (path: string) => void;
  activeCollectionFilter?: FileCollection | null;
  onToggleCollectionFilter?: (collection: FileCollection) => void;
  onCreateCollection?: () => void;
  onEditCollection?: (collection: FileCollection) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sectionHeight: number | undefined;
  onResizeStart: (sectionId: string, e: React.MouseEvent) => void;
}

const SidebarCollections = ({
  currentPath,
  navigateToPath,
  activeCollectionFilter,
  onToggleCollectionFilter,
  onCreateCollection,
  onEditCollection,
  collapsed,
  onToggleCollapsed,
  sectionHeight,
  onResizeStart,
}: SidebarCollectionsProps) => {
  const { t } = useTranslation();
  const [collections, setCollections] = useState<FileCollection[]>([]);
  const [collectionContextMenu, setCollectionContextMenu] = useState<{
    x: number;
    y: number;
    collection: FileCollection;
  } | null>(null);

  useEffect(() => {
    setCollections(getAllCollections());
  }, []);

  useWindowEvent('collections-changed', () => setCollections(getAllCollections()));

  useEffect(() => {
    if (!collectionContextMenu) return;
    const close = () => setCollectionContextMenu(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [collectionContextMenu]);

  return (
    <>
      <div
        className="border-b border-xp-border"
        role="region"
        aria-label="Collections"
        data-sidebar-section="collections"
      >
        <div className="flex items-center justify-between">
          <button
            className="hover:bg-xp-surface-light/50 flex flex-1 items-center px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-xp-text-muted transition-colors"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label="Toggle collections"
          >
            {collapsed ? (
              <ChevronRight className="mr-1 h-3 w-3 flex-shrink-0" />
            ) : (
              <ChevronDown className="mr-1 h-3 w-3 flex-shrink-0" />
            )}
            {t('sidebar.collections')}
          </button>
          {onCreateCollection && !collapsed && (
            <button
              onClick={onCreateCollection}
              className="mr-2 text-xp-text-muted transition-colors hover:text-xp-blue"
              title="Create new collection"
              aria-label="Create new collection"
              style={{ padding: '2px' }}
            >
              <Plus size={13} />
            </button>
          )}
        </div>
        {!collapsed && (
          <div
            className="space-y-0.5 overflow-y-auto px-3 pb-2"
            style={sectionHeight ? { maxHeight: sectionHeight } : undefined}
          >
            {collections.length === 0 ? (
              <p className="py-1 text-xs text-xp-text-secondary">{t('sidebar.noCollections')}</p>
            ) : (
              collections.map((col) => {
                const smartFolder = isSmartFolder(col);
                const isActive = smartFolder
                  ? currentPath === `collection://${col.id}`
                  : activeCollectionFilter?.id === col.id;
                return (
                  <div
                    key={col.id}
                    className={`group flex w-full cursor-pointer items-center rounded px-2 py-1 text-xs transition-colors ${
                      isActive
                        ? 'wisp-sidebar-item-active'
                        : 'text-xp-text hover:bg-xp-surface-light'
                    }`}
                    onClick={() => {
                      if (smartFolder) {
                        navigateToPath(`collection://${col.id}`);
                      } else {
                        onToggleCollectionFilter?.(col);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!col.builtin) {
                        setCollectionContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          collection: col,
                        });
                      }
                    }}
                    title={`${col.name} - ${col.filters.length} filter${col.filters.length !== 1 ? 's' : ''}${smartFolder ? ' (smart folder)' : ' (quick filter)'}`}
                  >
                    <span className="mr-2 flex-shrink-0 text-sm" aria-hidden="true">
                      {renderIcon(col.icon, 14)}
                    </span>
                    <span className="flex-1 truncate">{col.name}</span>
                    {smartFolder && (
                      <span
                        className="ml-auto flex-shrink-0 rounded-full bg-xp-surface px-1.5 py-0 text-[10px] text-xp-text-muted"
                        style={{ minWidth: '18px', textAlign: 'center' }}
                      >
                        {col.filters.length}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
        {/* Resize handle */}
        {!collapsed && (
          <div
            className="group flex h-2 cursor-row-resize items-center justify-center transition-colors hover:bg-xp-surface-light"
            onMouseDown={(e) => onResizeStart('collections', e)}
          >
            <GripHorizontal className="text-xp-text-muted/20 group-hover:text-xp-text-muted/60 h-3 w-4 transition-colors" />
          </div>
        )}
      </div>

      {/* Collection context menu (inline) */}
      {collectionContextMenu && (
        <div
          style={{
            position: 'fixed',
            left: collectionContextMenu.x,
            top: collectionContextMenu.y,
            zIndex: 9999,
            minWidth: '120px',
            borderRadius: '8px',
            backgroundColor: 'var(--xp-surface)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--xp-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            padding: '4px',
            animation: 'fadeIn 100ms ease-out',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center rounded px-3 py-1.5 text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
            onClick={() => {
              if (onEditCollection) onEditCollection(collectionContextMenu.collection);
              setCollectionContextMenu(null);
            }}
          >
            Edit
          </button>
          <button
            className="flex w-full items-center rounded px-3 py-1.5 text-xs text-xp-red transition-colors hover:bg-xp-surface-light"
            onClick={() => {
              deleteCollection(collectionContextMenu.collection.id);
              setCollectionContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </>
  );
};

export default SidebarCollections;
