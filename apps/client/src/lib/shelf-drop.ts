import type { ShelfRequest } from '@/lib/tauri-api';
import { requestShelf } from '@/hooks/use-shelf-state';
import i18n from '@/i18n';

const shelfDestination = (path: string): { shelfId?: string } =>
  path.startsWith('shelf:') ? { shelfId: path.slice(6) } : {};

const collect = (request: ShelfRequest) => {
  void requestShelf(request).catch((error) =>
    window.dispatchEvent(
      new CustomEvent('drag-drop-error', {
        detail: { message: String(error) },
      }),
    ),
  );
};

export const collectShelfFiles = (paths: string[], target: string) => {
  collect({ action: 'addFiles', paths, ...shelfDestination(target) });
};

export const collectShelfContent = (transfer: DataTransfer, target: string) => {
  const url = transfer
    .getData('text/uri-list')
    .split(/[\r\n]+/)
    .find((line) => line && !line.startsWith('#'))
    ?.trim();
  const html = transfer.getData('text/html');
  const text = transfer.getData('text/plain') || transfer.getData('public.utf8-plain-text');
  if (!url && !html && !text) {
    if (Array.from(transfer.files).some((file) => file.type.startsWith('image/'))) {
      window.dispatchEvent(
        new CustomEvent('drag-drop-error', {
          detail: { message: i18n.t('shelf.imageDropNeedsFile') },
        }),
      );
    }
    return;
  }
  collect({
    action: 'addContent',
    ...shelfDestination(target),
    ...(url ? { url } : {}),
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
  });
};
