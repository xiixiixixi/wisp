import { describe, it, expect } from 'vitest';
import { ancestorPaths } from '@/lib/path-ancestry';

describe('ancestorPaths', () => {
  it('walks from the nearest parent down to the filesystem root', () => {
    expect(ancestorPaths('/Users/weixili/Downloads/foo')).toEqual([
      '/Users/weixili/Downloads',
      '/Users/weixili',
      '/Users',
      '/',
    ]);
  });

  it('keeps the root as the only ancestor of a top-level folder', () => {
    expect(ancestorPaths('/foo')).toEqual(['/']);
  });

  it('returns nothing for the root itself', () => {
    expect(ancestorPaths('/')).toEqual([]);
  });

  it('handles trailing separators', () => {
    expect(ancestorPaths('/Users/x/')).toEqual(['/Users', '/']);
  });

  it('returns nothing for an empty path', () => {
    expect(ancestorPaths('')).toEqual([]);
  });

  it('walks Windows-style paths down to the drive root', () => {
    expect(ancestorPaths('C:\\Users\\x\\foo')).toEqual(['C:\\Users\\x', 'C:\\Users', 'C:']);
    expect(ancestorPaths('C:\\')).toEqual([]);
  });
});
