/** Fit a contiguous suffix, always retaining the current directory. Widths include separators. */
export function getBreadcrumbStart(
  widths: number[],
  availableWidth: number,
  gap = 4,
  overflowWidth = 28,
): number {
  if (widths.length <= 1 || availableWidth <= 0) return 0;
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  if (total <= availableWidth) return 0;

  const budget = Math.max(0, availableWidth - overflowWidth - gap);
  let start = widths.length - 1;
  let used = widths[start];
  while (start > 0 && used + gap + widths[start - 1] <= budget) {
    used += gap + widths[--start];
  }
  return start;
}
