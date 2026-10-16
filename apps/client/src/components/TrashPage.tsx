import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { TauriAPI, type TrashItem } from '@/lib/tauri-api';
import { useToast } from '@/hooks/use-toast';
import { getFileIcon, formatFileSize, formatDate } from '@/lib/utils';
import { Trash2, Undo2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { showConfirmationToast } from '@/components/ui/Toast';
import ContextMenu, { type ContextMenuItem } from '@/components/ui/ContextMenu';
import { emptyTrashWithConfirmation } from '@/lib/trash-empty';
import { FILES_CHANGED_EVENT } from '@/lib/file-change-events';

interface RecycleBinProps {
  /** 路径栏右侧 actions 槽；传入则把回收站操作传送过去（与其他页面工具条同位） */
  toolbarTarget?: HTMLElement | null;
}

const RecycleBin = ({ toolbarTarget }: RecycleBinProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(
    null,
  );
  const [backgroundMenu, setBackgroundMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Query trash items
  const {
    data: trashItems = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['trash-items'],
    queryFn: () => TauriAPI.getTrashItems(),
    staleTime: 30000,
  });

  // Show toast notification for errors
  useEffect(() => {
    if (error) {
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastLoadErrorTitle'),
        description: t('pages.trash.toastLoadErrorDesc', { error: (error as Error).message }),
      });
    }
  }, [error, toast, t]);

  // Another surface (sidebar 清倒废纸篓) may have emptied or changed the
  // trash — refresh whenever file panes do.
  useEffect(() => {
    const onChange = () => refetch();
    window.addEventListener(FILES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(FILES_CHANGED_EVENT, onChange);
  }, [refetch]);

  // The backend now reports where an item lives in the trash; operations
  // target that path while the display keeps the original location.
  const getItemId = (item: TrashItem): string => item.trash_path ?? item.original_path;
  // #61: 放回原处 needs put-back metadata (Finder's .DS_Store or Wisp's
  // ledger); without it the action would be a guess, so it stays hidden.
  const canPutBack = (item: TrashItem): boolean =>
    Boolean(item.trash_path) && item.trash_path !== item.original_path;

  const handleSelectItem = (itemId: string, event?: React.MouseEvent) => {
    if (event && (event.ctrlKey || event.metaKey)) {
      // Ctrl+click for multi-select
      setSelectedItems((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(itemId)) {
          newSet.delete(itemId);
        } else {
          newSet.add(itemId);
        }
        return newSet;
      });
    } else {
      // Single select
      setSelectedItems(new Set([itemId]));
    }
  };

  const handleRestore = async (itemId?: string) => {
    const trashItemsToRestore = itemId
      ? [itemId]
      : Array.from(selectedItems)
          .map((id) => trashItems.find((item) => getItemId(item) === id))
          .filter((item): item is TrashItem => Boolean(item && canPutBack(item)))
          .map(getItemId);

    if (trashItemsToRestore.length === 0) {
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastNoItemsTitle'),
        description: t('pages.trash.toastNoItemsRestoreDesc'),
      });
      return;
    }

    const confirmed = await showConfirmationToast({
      title: t('pages.trash.confirmRestoreTitle'),
      description: t('pages.trash.confirmRestoreDesc', { count: trashItemsToRestore.length }),
      confirmText: t('pages.trash.confirmRestoreBtn'),
      cancelText: t('common.cancel'),
    });

    if (!confirmed) return;

    try {
      const restoredPaths: string[] = [];
      for (const trashPath of trashItemsToRestore) {
        const restoredPath = await TauriAPI.restoreFromTrash(trashPath);
        restoredPaths.push(restoredPath);
      }

      setSelectedItems(new Set());
      refetch();

      toast({
        title: t('pages.trash.toastRestoredTitle'),
        description: t('pages.trash.toastRestoredDesc', { count: restoredPaths.length }),
      });
    } catch (error) {
      console.error('Failed to restore items:', error);
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastRestoreFailedTitle'),
        description: t('pages.trash.toastRestoreFailedDesc', {
          error: (error as Error).message,
        }),
      });
    }
  };

  const handlePermanentDelete = async (itemId?: string) => {
    const trashItemsToDelete = itemId
      ? [itemId]
      : Array.from(selectedItems)
          .map((id) => trashItems.find((item) => getItemId(item) === id))
          .filter((item): item is TrashItem => Boolean(item))
          .map(getItemId);

    if (trashItemsToDelete.length === 0) {
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastNoItemsTitle'),
        description: t('pages.trash.toastNoItemsDeleteDesc'),
      });
      return;
    }

    const confirmed = await showConfirmationToast({
      title: t('pages.trash.confirmDeleteTitle'),
      description: t('pages.trash.confirmDeleteDesc', { count: trashItemsToDelete.length }),
      confirmText: t('pages.trash.confirmDeleteBtn'),
      cancelText: t('common.cancel'),
    });

    if (!confirmed) return;

    try {
      for (const trashPath of trashItemsToDelete) {
        await TauriAPI.permanentlyDeleteFromTrash(trashPath);
      }

      setSelectedItems(new Set());
      refetch();

      toast({
        title: t('pages.trash.toastDeletedTitle'),
        description: t('pages.trash.toastDeletedDesc', { count: trashItemsToDelete.length }),
      });
    } catch (error) {
      console.error('Failed to permanently delete items:', error);
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastDeleteFailedTitle'),
        description: t('pages.trash.toastDeleteFailedDesc', {
          error: (error as Error).message,
        }),
      });
    }
  };

  // #59: 清倒废纸篓… — same confirm + empty channel as the toolbar and the
  // sidebar trash entry.
  const handleEmptyTrash = useCallback(() => {
    void emptyTrashWithConfirmation({
      t,
      toast,
      itemCount: trashItems.length,
      onEmptied: () => setSelectedItems(new Set()),
    }).finally(() => refetch());
  }, [t, toast, trashItems.length, refetch]);

  // #61/#62: Finder's trash row menu — 放回原处 first, 立即删除… after.
  const handleRowContextMenu = (item: TrashItem, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    handleSelectItem(getItemId(item));
    const menuItems: ContextMenuItem[] = [];
    if (canPutBack(item)) {
      menuItems.push({
        id: 'put-back',
        label: t('contextMenu.putBack'),
        icon: <Undo2 size={14} className="inline-block" />,
        action: () => void handleRestore(getItemId(item)),
      });
      menuItems.push({ id: 'sep-put-back', label: '', separator: true });
    }
    menuItems.push({
      id: 'delete-immediately',
      label: t('contextMenu.deleteImmediately'),
      icon: <Trash2 size={14} className="inline-block" />,
      danger: true,
      action: () => void handlePermanentDelete(getItemId(item)),
    });
    setRowMenu({ x: event.clientX, y: event.clientY, items: menuItems });
  };

  const hasSelection = selectedItems.size > 0;

  // 操作条（与其他页面的窗格工具条同位同款）：
  // 无选中 → 只显示"清空回收站"；有选中 → 换成"还原(n)/永久删除(n)"。
  const toolbar = (
    <div className="wisp-operationbar wisp-component-toolbar wisp-no-select">
      <div className="wisp-operationbar-layout @container flex items-center justify-end gap-4">
        <div className="wisp-toolbar-controls wisp-toolbar-controls-secondary flex flex-shrink-0 items-center">
          {hasSelection ? (
            <>
              <button
                type="button"
                className="wisp-control flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:text-xp-text disabled:pointer-events-none disabled:opacity-50"
                onClick={() => handleRestore()}
                aria-label={t('pages.trash.ariaRestoreCount', { count: selectedItems.size })}
              >
                <Undo2 size={14} aria-hidden="true" />
                <span className="ob-label-md whitespace-nowrap">
                  {t('pages.trash.restoreCount', { count: selectedItems.size })}
                </span>
              </button>
              <button
                type="button"
                className="wisp-control flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:text-xp-red disabled:pointer-events-none disabled:opacity-50"
                onClick={() => handlePermanentDelete()}
                aria-label={t('pages.trash.ariaDeleteCount', { count: selectedItems.size })}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span className="ob-label-md whitespace-nowrap">
                  {t('pages.trash.deletePermanentlyCount', { count: selectedItems.size })}
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="wisp-control flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:text-xp-red disabled:pointer-events-none disabled:opacity-50"
              disabled={trashItems.length === 0}
              onClick={handleEmptyTrash}
              aria-label={t('pages.trash.ariaEmptyBin')}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span className="ob-label-md whitespace-nowrap">
                {t('pages.trash.emptyRecycleBin')}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="flex h-full flex-col text-xp-text"
      data-drop-target=""
      data-drop-action="trash"
    >
      {/* 操作条：有路径栏槽就传送过去（与其他页面工具条同位），没有则原位显示 */}
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}

      {/* Content */}
      <div
        className="flex-1 overflow-auto p-4"
        onContextMenu={(e) => {
          // #59: the trash background grows Finder's 清倒废纸篓…
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setBackgroundMenu({ x: e.clientX, y: e.clientY });
          }
        }}
      >
        {(() => {
          if (isLoading) {
            return (
              <div className="flex h-full items-center justify-center">
                <div className="text-xp-text-muted">{t('pages.trash.loading')}</div>
              </div>
            );
          }
          if (trashItems.length === 0) {
            return (
              <div className="wisp-preview-empty flex h-full items-center justify-center text-center text-xp-text-secondary">
                <div className="wisp-preview-empty-content">
                  <div className="wisp-preview-empty-visual" aria-hidden="true">
                    <Trash2 size={40} strokeWidth={1.25} />
                  </div>
                  <h4>{t('pages.trash.empty')}</h4>
                  <p>{t('pages.trash.emptyHint')}</p>
                </div>
              </div>
            );
          }
          return (
            <div className="grid grid-cols-1 gap-2">
              {trashItems.map((item) => {
                const itemId = getItemId(item);
                return (
                <div
                  key={itemId}
                  onClick={(e) => handleSelectItem(itemId, e)}
                  onContextMenu={(e) => handleRowContextMenu(item, e)}
                  className={`flex cursor-pointer items-center rounded-md p-3 hover:bg-xp-surface ${
                    selectedItems.has(itemId) ? 'bg-xp-accent bg-opacity-20' : ''
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center">
                    <div className="mr-3 text-xl">
                      {getFileIcon({
                        name: item.name,
                        is_dir: item.is_dir,
                        path: item.original_path,
                        size: item.size,
                        modified: item.deletion_date,
                        file_type: item.name.split('.').pop() || '',
                        is_readonly: false,
                      })}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-xp-text">{item.name}</div>
                      <div className="truncate text-sm text-xp-text-muted">
                        {item.original_path}
                      </div>
                    </div>
                    <div className="ml-4 text-sm text-xp-text-muted">
                      {!item.is_dir && formatFileSize(item.size)}
                    </div>
                    <div className="ml-4 text-sm text-xp-text-muted">
                      {formatDate(item.deletion_date * 1000)}
                    </div>
                    <div className="ml-4 flex space-x-2">
                      {canPutBack(item) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRestore(itemId);
                          }}
                          className="rounded-md bg-xp-blue px-2 py-1 text-xs text-xp-on-accent hover:opacity-80"
                          aria-label={t('pages.trash.ariaRestoreItem', { name: item.name })}
                        >
                          {t('pages.trash.restore')}
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePermanentDelete(itemId);
                        }}
                        className="rounded-md bg-xp-red px-2 py-1 text-xs text-xp-on-accent hover:opacity-80"
                        aria-label={t('pages.trash.ariaDeleteItem', { name: item.name })}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Footer */}
      <div className="border-t border-xp-border p-4 text-sm text-xp-text-muted">
        {t('pages.trash.footer', {
          count: trashItems.length,
          defaultValue: `${trashItems.length} item${trashItems.length !== 1 ? 's' : ''} in recycle bin`,
        })}
        {selectedItems.size > 0 && t('pages.trash.footerSelected', { count: selectedItems.size })}
      </div>

      {/* #61/#62: row menu — 放回原处 first when the metadata exists */}
      <ContextMenu
        isOpen={rowMenu !== null}
        x={rowMenu?.x ?? 0}
        y={rowMenu?.y ?? 0}
        items={rowMenu?.items ?? []}
        onClose={() => setRowMenu(null)}
      />
      {/* #59: background menu — 清倒废纸篓… */}
      <ContextMenu
        isOpen={backgroundMenu !== null}
        x={backgroundMenu?.x ?? 0}
        y={backgroundMenu?.y ?? 0}
        items={[
          {
            id: 'empty-trash',
            label: t('contextMenu.emptyTrash'),
            icon: <Trash2 size={14} className="inline-block" />,
            danger: true,
            action: handleEmptyTrash,
          },
        ]}
        onClose={() => setBackgroundMenu(null)}
      />
    </div>
  );
};

export default RecycleBin;
