import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { extensionHost } from '@/lib/extension-host';

const { checkForUpdates } = vi.hoisted(() => ({ checkForUpdates: vi.fn() }));
vi.mock('@/lib/extension-host-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/extension-host-queries')>()),
  checkForUpdates,
}));

describe('retired automatic extension updates', () => {
  beforeEach(() => {
    localStorage.clear();
    checkForUpdates.mockResolvedValue([
      {
        id: 'test.extension',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        downloadUrl: 'https://example.invalid/extension',
        checksum: 'test-checksum',
      },
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([null, 'true', 'false'])(
    'does not install updates with a legacy setting of %s',
    async (saved) => {
      if (saved !== null) localStorage.setItem('wisp:auto-update-extensions', saved);
      const apply = vi.spyOn(extensionHost, 'applyExtensionUpdate').mockResolvedValue(true);
      const host = extensionHost as unknown as {
        checkForUpdatesAndNotify: (
          installed: Array<{ manifest: { id: string; version: string } }>,
        ) => Promise<void>;
      };
      await host.checkForUpdatesAndNotify([
        { manifest: { id: 'test.extension', version: '1.0.0' } },
      ]);
      expect(checkForUpdates).toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
    },
  );
});
