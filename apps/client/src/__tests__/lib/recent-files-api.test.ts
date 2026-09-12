import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRecentFile,
  getRecentFiles,
  clearRecentFiles,
  removeRecentFile,
} from '@/lib/tauri-api/file-system';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { transport } from '@/lib/transport';

vi.mock('@/lib/transport', () => ({
  transport: vi.fn(),
  listenToEvent: vi.fn(),
  isTauri: vi.fn(() => false),
}));
vi.mock('@/lib/browser-demo-files', async (original) => ({
  ...(await original<typeof import('@/lib/browser-demo-files')>()),
  isBrowserDemoMode: vi.fn(() => true),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isBrowserDemoMode).mockReturnValue(true);
});

describe('recent API synchronization', () => {
  it('shares one demo store for additions, removals, clearing and events without disk calls', async () => {
    const events = vi.fn();
    window.addEventListener('recent-files-changed', events);
    try {
      await clearRecentFiles();
      expect(await getRecentFiles()).toEqual([]);
      await addRecentFile('/home/user/Documents');
      expect(await getRecentFiles()).toEqual([
        expect.objectContaining({ path: '/home/user/Documents', file_type: 'folder' }),
      ]);
      await addRecentFile('/home/user/Documents');
      expect(await getRecentFiles()).toHaveLength(1);
      await removeRecentFile('/home/user/Documents');
      expect(await getRecentFiles()).toEqual([]);
      expect(events).toHaveBeenCalledTimes(4);
      expect(transport).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('recent-files-changed', events);
    }
  });

  it('does not emit an update when a desktop history mutation fails', async () => {
    vi.mocked(isBrowserDemoMode).mockReturnValue(false);
    vi.mocked(transport).mockRejectedValueOnce(new Error('Unavailable'));
    const events = vi.fn();
    window.addEventListener('recent-files-changed', events);
    try {
      await expect(removeRecentFile('/missing')).rejects.toThrow('Unavailable');
      expect(events).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('recent-files-changed', events);
    }
  });
});
