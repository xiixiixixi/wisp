/**
 * Ancestor directory paths of `path`, nearest parent first, excluding `path`
 * itself. Handles both separators and keeps the filesystem root (`/`) as the
 * final entry when applicable. Used to land on the nearest surviving folder
 * when the current one is deleted externally.
 */
export const ancestorPaths = (path: string): string[] => {
  if (!path) return [];
  const sep = path.includes('\\') ? '\\' : '/';
  const root = sep === '\\' ? path.slice(0, 2) : '/';
  const chain: string[] = [];
  let current = path.endsWith(sep) && path !== root ? path.slice(0, -sep.length) : path;

  while (current !== root) {
    const idx = current.lastIndexOf(sep);
    if (idx < 0) break;
    const parent = idx === 0 ? root : current.slice(0, idx);
    if (parent === current || parent.length === 0) break;
    chain.push(parent);
    if (parent === root) break;
    current = parent;
  }
  return chain;
};
