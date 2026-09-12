import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDetailedFileProperties } from '@/lib/tauri-api/file-system';
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

describe('demo detailed file properties', () => {
  it('reads the revealed search file from fixtures without a backend request', async () => {
    expect(await getDetailedFileProperties('/home/user/Documents/Q3-launch-plan.md')).toEqual(
      expect.objectContaining({
        name: 'Q3-launch-plan.md',
        size: 18432,
        is_directory: false,
        extension: 'md',
        permissions: expect.objectContaining({ readable: true, writable: true }),
      }),
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('provides the selected demo directory item count', async () => {
    expect(await getDetailedFileProperties('/home/user/Documents/Launch')).toEqual(
      expect.objectContaining({
        is_directory: true,
        attributes: { item_count: 2 },
      }),
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('reads hidden demo files even though search excludes them', async () => {
    expect(await getDetailedFileProperties('/home/user/Documents/.secret-notes.md')).toEqual(
      expect.objectContaining({ name: '.secret-notes.md', is_hidden: true, size: 512 }),
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects a missing demo entry locally instead of contacting the backend', async () => {
    await expect(getDetailedFileProperties('/home/user/missing.md')).rejects.toThrow(
      'Demo entry is unavailable',
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('preserves the native detailed properties request and result', async () => {
    vi.mocked(isBrowserDemoMode).mockReturnValue(false);
    const nativeResult = { path: '/Users/user/real.md' };
    vi.mocked(transport).mockResolvedValueOnce(nativeResult);
    expect(await getDetailedFileProperties(nativeResult.path)).toBe(nativeResult);
    expect(transport).toHaveBeenCalledWith('get_detailed_file_properties', {
      filePath: nativeResult.path,
    });
  });
});
