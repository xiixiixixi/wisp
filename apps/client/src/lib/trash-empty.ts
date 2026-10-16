import type { TFunction } from 'i18next';
import { TauriAPI } from '@/lib/tauri-api';
import { showConfirmationToast } from '@/components/ui/Toast';
import { dispatchLocalFilesChanged } from '@/lib/file-change-events';

type TrashToast = (opts: {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

interface EmptyTrashOptions {
  t: TFunction;
  toast: TrashToast;
  /** Known item count; omitted → fetched before confirming. */
  itemCount?: number;
  /** Runs after a successful empty (clear selection, refetch…). */
  onEmptied?: (deletedCount: number) => void;
}

/**
 * Finder's 清倒废纸篓… — one confirmation, then the shared empty channel.
 * Used by the trash page (toolbar + background right-click) and the sidebar
 * trash entry's context menu, so every surface behaves identically (#59).
 */
export const emptyTrashWithConfirmation = async ({
  t,
  toast,
  itemCount,
  onEmptied,
}: EmptyTrashOptions): Promise<void> => {
  let count = itemCount;
  if (count === undefined) {
    try {
      count = (await TauriAPI.getTrashItems()).length;
    } catch {
      count = 0;
    }
  }
  if (count === 0) {
    toast({
      title: t('pages.trash.toastAlreadyEmptyTitle'),
      description: t('pages.trash.toastAlreadyEmptyDesc'),
    });
    return;
  }

  const confirmed = await showConfirmationToast({
    title: t('pages.trash.confirmEmptyTitle'),
    description: t('pages.trash.confirmEmptyDesc', { count }),
    confirmText: t('pages.trash.confirmEmptyBtn'),
    cancelText: t('common.cancel'),
  });
  if (!confirmed) return;

  try {
    const deletedCount = await TauriAPI.emptyTrash();
    onEmptied?.(deletedCount);
    // An open trash pane (or any pane) should drop the emptied entries.
    dispatchLocalFilesChanged();
    toast({
      title: t('pages.trash.toastEmptiedTitle'),
      description: t('pages.trash.toastEmptiedDesc', { count: deletedCount }),
    });
  } catch (error) {
    console.error('Failed to empty trash:', error);
    toast({
      variant: 'destructive',
      title: t('pages.trash.toastEmptyFailedTitle'),
      description: t('pages.trash.toastEmptyFailedDesc', {
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }
};
