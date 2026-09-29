/** Match a location and its descendants without confusing similarly named folders. */
export const containsNavigationPath = (location: string, currentPath: string): boolean => {
  if (location.includes('://') || currentPath.includes('://')) return location === currentPath;
  const normalize = (path: string) => {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const root = normalize(location);
  const current = normalize(currentPath);
  return root === current || current.startsWith(root === '/' ? '/' : `${root}/`);
};

export const currentNavigationLocation = (locations: string[], currentPath: string) =>
  locations
    .filter((path) => containsNavigationPath(path, currentPath))
    .sort((a, b) => b.length - a.length)[0];
