import type { FileEntry, ShelfItem } from '@/lib/tauri-api';

export const fileEntryFor = (item: ShelfItem): FileEntry => ({
  path: item.path,
  name: item.name,
  is_dir: item.isDirectory ?? false,
  size: item.size ?? 0,
  modified: Math.floor(item.addedAt / 1000),
  file_type: item.kind,
  is_readonly: false,
});
