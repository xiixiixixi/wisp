import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AirDropError, openAirDrop } from '@/lib/tauri-api/airdrop';
import { isTauri, transport } from '@/lib/transport';

vi.mock('@/lib/transport', () => ({ isTauri: vi.fn(), transport: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(transport).mockResolvedValue(undefined);
});

describe('AirDrop native bridge', () => {
  it('rejects browser calls without using the HTTP backend', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(openAirDrop()).rejects.toMatchObject({ code: 'unsupported' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('requests the Finder entry point with an empty selection by default', async () => {
    await expect(openAirDrop()).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledWith('open_airdrop', { paths: [] });
  });

  it('passes the exact selected paths without any recipient or send confirmation', async () => {
    const paths = ['/Users/me/A file.txt', '/Users/me/Folder'];
    await openAirDrop(paths);
    expect(transport).toHaveBeenCalledWith('open_airdrop', { paths });
  });

  it.each(['unsupported', 'invalid_paths', 'unavailable', 'launch_failed'])(
    'preserves the native %s error code for localized UI',
    async (code) => {
      vi.mocked(transport).mockRejectedValueOnce({ code, message: 'Native failure' });
      await expect(openAirDrop(['/Users/me/file.txt'])).rejects.toMatchObject({
        name: 'AirDropError',
        code,
        message: 'Native failure',
      });
    },
  );

  it('normalizes unexpected transport errors without claiming success', async () => {
    vi.mocked(transport).mockRejectedValueOnce('IPC disconnected');
    await expect(openAirDrop()).rejects.toEqual(
      new AirDropError('launch_failed', 'IPC disconnected'),
    );
  });
});
