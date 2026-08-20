import { describe, it, expect } from 'vitest';
import { planTransfer } from '@/lib/drag-transfer';
import type { ConflictInfo } from '@/lib/tauri-api';

const conflictInfo = (
  src: string,
  dst: string,
  srcIsDir = false,
  dstIsDir = false,
): ConflictInfo => ({
  source: {
    path: src,
    name: src.split('/').pop() ?? src,
    is_dir: srcIsDir,
    size: 0,
    modified: 0,
  },
  destination: {
    path: dst,
    name: dst.split('/').pop() ?? dst,
    is_dir: dstIsDir,
    size: 0,
    modified: 0,
  },
});

const keepBoth = () => 'keepBoth';
const skip = () => 'skip';
const overwrite = () => 'overwrite';
const merge = () => 'merge';

describe('planTransfer', () => {
  it('builds plain destinations when there are no conflicts', async () => {
    const plan = await planTransfer(
      ['/src/a.txt', '/src/b.txt'],
      '/dst',
      [],
      keepBoth,
      async () => '',
    );

    expect(plan.items).toEqual([
      { source: '/src/a.txt', dest: '/dst/a.txt' },
      { source: '/src/b.txt', dest: '/dst/b.txt' },
    ]);
    expect(plan.skippedCount).toBe(0);
  });

  it('drops conflicting sources with the skip policy', async () => {
    const conflicts = [conflictInfo('/src/a.txt', '/dst/a.txt')];
    const plan = await planTransfer(
      ['/src/a.txt', '/src/b.txt'],
      '/dst',
      conflicts,
      skip,
      async () => '',
    );

    expect(plan.items).toEqual([{ source: '/src/b.txt', dest: '/dst/b.txt' }]);
    expect(plan.skippedCount).toBe(1);
  });

  it('resolves a new destination name with the keepBoth policy', async () => {
    const conflicts = [conflictInfo('/src/a.txt', '/dst/a.txt')];
    const plan = await planTransfer(
      ['/src/a.txt'],
      '/dst',
      conflicts,
      keepBoth,
      async (name) => `/dst/${name.replace('.txt', ' (2).txt')}`,
    );

    expect(plan.items[0].dest).toBe('/dst/a (2).txt');
  });

  it('marks conflicting sources for overwrite', async () => {
    const conflicts = [conflictInfo('/src/a.txt', '/dst/a.txt')];
    const plan = await planTransfer(['/src/a.txt'], '/dst', conflicts, overwrite, async () => '');

    expect(plan.items[0]).toEqual({ source: '/src/a.txt', dest: '/dst/a.txt', overwrite: true });
  });

  it('only merges folder-vs-folder conflicts; file conflicts fall back to overwrite', async () => {
    const conflicts = [
      conflictInfo('/src/folder', '/dst/folder', true, true),
      conflictInfo('/src/f.txt', '/dst/f.txt'),
    ];
    const plan = await planTransfer(
      ['/src/folder', '/src/f.txt'],
      '/dst',
      conflicts,
      merge,
      async () => '',
    );

    expect(plan.items.find((i) => i.source === '/src/folder')).toEqual({
      source: '/src/folder',
      dest: '/dst/folder',
      merge: true,
    });
    expect(plan.items.find((i) => i.source === '/src/f.txt')).toEqual({
      source: '/src/f.txt',
      dest: '/dst/f.txt',
      overwrite: true,
    });
  });

  it('applies per-source policies via the policyFor callback', async () => {
    const conflicts = [
      conflictInfo('/src/a.txt', '/dst/a.txt'),
      conflictInfo('/src/b.txt', '/dst/b.txt'),
    ];
    const policyFor = (source: string) => (source.endsWith('b.txt') ? 'skip' : 'overwrite');
    const plan = await planTransfer(
      ['/src/a.txt', '/src/b.txt'],
      '/dst',
      conflicts,
      policyFor,
      async () => '',
    );

    expect(plan.items).toEqual([{ source: '/src/a.txt', dest: '/dst/a.txt', overwrite: true }]);
    expect(plan.skippedCount).toBe(1);
  });
});
