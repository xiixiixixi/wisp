import { describe, expect, it } from 'vitest';
import { getBreadcrumbStart } from '@/lib/breadcrumb-layout';

describe('trailing breadcrumb priority', () => {
  it('shows the whole path when it fits, including the exact boundary', () => {
    expect(getBreadcrumbStart([40, 60, 80], 188)).toBe(0);
  });
  it('drops the oldest ancestors before the nearest parent', () => {
    expect(getBreadcrumbStart([40, 60, 80, 100], 220)).toBe(2);
  });
  it('keeps the current directory even when its label alone is too long', () => {
    expect(getBreadcrumbStart([40, 60, 800], 120)).toBe(2);
  });
  it('handles empty, root-only and not-yet-measured layouts', () => {
    expect(getBreadcrumbStart([], 300)).toBe(0);
    expect(getBreadcrumbStart([400], 100)).toBe(0);
    expect(getBreadcrumbStart([40, 60], 0)).toBe(0);
  });
  it('restores ancestors as a pane grows', () => {
    expect(getBreadcrumbStart([40, 60, 80, 100], 140)).toBe(3);
    expect(getBreadcrumbStart([40, 60, 80, 100], 280)).toBe(1);
    expect(getBreadcrumbStart([40, 60, 80, 100], 400)).toBe(0);
  });
});
