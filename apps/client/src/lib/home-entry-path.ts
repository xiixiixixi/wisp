import { parentDirectory } from '@/lib/recent-entry-actions';

export const homeParentLabel = (path: string, home: string) => {
  const parent = parentDirectory(path);
  if (!home) return parent;
  const root = home.replace(/[/\\]+$/, '');
  if (parent === root) return '~';
  if (parent.startsWith(`${root}/`) || parent.startsWith(`${root}\\`)) {
    return `~${parent.slice(root.length)}`;
  }
  return parent;
};
