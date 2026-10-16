export const normalizeNavigationPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
};

/** Match a location and its descendants without confusing similarly named folders. */
export const containsNavigationPath = (location: string, currentPath: string): boolean => {
  if (location.includes('://') || currentPath.includes('://')) return location === currentPath;
  const root = normalizeNavigationPath(location);
  const current = normalizeNavigationPath(currentPath);
  return root === current || current.startsWith(root === '/' ? '/' : `${root}/`);
};

/**
 * True when `candidate` pins the current location down more specifically than
 * `other`. Ties (equal depth) go to `other` — the earlier sidebar section that
 * already claimed the highlight keeps it.
 */
export const isCloserNavigationMatch = (candidate: string, other: string | undefined): boolean =>
  other === undefined ||
  normalizeNavigationPath(candidate).length > normalizeNavigationPath(other).length;

export const currentNavigationLocation = (locations: string[], currentPath: string) =>
  locations
    .filter((path) => containsNavigationPath(path, currentPath))
    .sort(
      (a, b) =>
        normalizeNavigationPath(b).length -
          normalizeNavigationPath(a).length || (a < b ? -1 : a > b ? 1 : 0),
    )[0];
