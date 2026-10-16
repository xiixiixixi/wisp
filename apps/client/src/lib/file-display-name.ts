/**
 * Finder-style label for a file name: with extensions hidden, only the last
 * extension is dropped ("report.pdf" → "report", "archive.tar.gz" →
 * "archive.tar"). Dotfiles like ".gitignore" and extensionless names such as
 * "README" stay whole, and directories never carry an extension to strip.
 */
export const getFileDisplayName = (name: string, showExtensions: boolean): string => {
  if (showExtensions || name.startsWith('.')) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  return name.slice(0, dot);
};
