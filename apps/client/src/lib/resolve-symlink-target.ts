import { PATH_SEPARATOR } from '@/lib/constants';
import type { FileEntry } from '@/lib/tauri-api';

/**
 * Absolute form of `FileEntry.symlink_target`. The backend mirrors
 * `fs::read_link`, which keeps whatever the link stores — including relative
 * targets — so anchor those to the link's own folder before use (#20).
 */
export const resolveSymlinkTarget = (file: FileEntry): string | null => {
  const target = file.symlink_target;
  if (!target) return null;
  if (target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target)) return target;
  const parent =
    file.path.split(/[\\/]/).slice(0, -1).join(PATH_SEPARATOR) || PATH_SEPARATOR;
  return `${parent}${PATH_SEPARATOR}${target}`;
};
