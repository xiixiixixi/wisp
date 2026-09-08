import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchGlobalFiles, type GlobalSearchUpdate } from '@/lib/global-file-search';
import { TauriAPI } from '@/lib/tauri-api';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    listDrives: vi.fn(),
    findFiles: vi.fn(),
    isDir: vi.fn(),
    enhancedSearch: vi.fn(),
    searchTokens: vi.fn(),
  },
}));
vi.mock('@/lib/browser-demo-files', () => ({
  isBrowserDemoMode: () => false,
  getDemoSearchFiles: vi.fn(),
}));
const drive = (path: string) => ({ path, letter: '', label: path, total_space: 0, free_space: 0 });
const indexed = (path: string) => ({
  path,
  filename: path.split('/').pop()!,
  matches: [],
  score: 1,
  relevance_type: 'exact',
});

describe('global file search', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(TauriAPI.listDrives).mockResolvedValue([drive('/')]);
    vi.mocked(TauriAPI.findFiles).mockResolvedValue([]);
    vi.mocked(TauriAPI.isDir).mockResolvedValue(false);
    vi.mocked(TauriAPI.enhancedSearch).mockResolvedValue({ results: [] } as never);
  });

  it('deduplicates by full path, not filename, and preserves real directory classification', async () => {
    const folder = '/Projects/report.md';
    const copy = '/Downloads/report.md';
    vi.mocked(TauriAPI.findFiles).mockResolvedValue([folder, copy]);
    vi.mocked(TauriAPI.isDir).mockImplementation(async (path) => path === folder);
    vi.mocked(TauriAPI.enhancedSearch).mockResolvedValue({ results: [indexed(folder)] } as never);
    const updates: GlobalSearchUpdate[] = [];
    await searchGlobalFiles('report', (update) => updates.push(update));
    expect(updates.at(-1)?.results.map((result) => [result.path, result.isDir])).toEqual([
      [folder, true],
      [copy, false],
    ]);
  });

  it('queries each Windows volume but does not repeat nested macOS mounts', async () => {
    vi.mocked(TauriAPI.listDrives).mockResolvedValue([drive('/'), drive('/Volumes/Archive')]);
    await searchGlobalFiles('report', vi.fn());
    expect(TauriAPI.findFiles).toHaveBeenCalledTimes(1);
    vi.mocked(TauriAPI.findFiles).mockClear();
    vi.mocked(TauriAPI.listDrives).mockResolvedValue([drive('C:\\'), drive('D:\\')]);
    await searchGlobalFiles('report', vi.fn());
    expect(TauriAPI.findFiles).toHaveBeenCalledWith('report', 'C:\\');
    expect(TauriAPI.findFiles).toHaveBeenCalledWith('report', 'D:\\');
  });

  it('retains available results and reports a partially unavailable volume search', async () => {
    vi.mocked(TauriAPI.listDrives).mockResolvedValue([drive('C:\\'), drive('D:\\')]);
    vi.mocked(TauriAPI.findFiles)
      .mockResolvedValueOnce(['C:\\report.md'])
      .mockRejectedValueOnce(new Error('unmounted'));
    const update = vi.fn();
    await searchGlobalFiles('report', update);
    expect(update.mock.lastCall?.[0]).toMatchObject({
      partial: true,
      results: [{ path: 'C:\\report.md' }],
    });
  });

  it('caps classification work and discloses the result limit', async () => {
    vi.mocked(TauriAPI.findFiles).mockResolvedValue(
      Array.from({ length: 120 }, (_, n) => `/Archive/report-${n}.md`),
    );
    const update = vi.fn();
    await searchGlobalFiles('report', update);
    expect(TauriAPI.isDir).toHaveBeenCalledTimes(50);
    expect(update.mock.lastCall?.[0].results).toHaveLength(50);
    expect(update.mock.lastCall?.[0].limited).toBe(true);
  });

  it('publishes system matches while the content index is still pending', async () => {
    let resolve!: (value: never) => void;
    vi.mocked(TauriAPI.enhancedSearch).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    vi.mocked(TauriAPI.findFiles).mockResolvedValue(['/Downloads/report.md']);
    const update = vi.fn();
    const pending = searchGlobalFiles('report', update);
    await vi.waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [expect.objectContaining({ path: '/Downloads/report.md' })],
        }),
      ),
    );
    resolve({ results: [] } as never);
    await pending;
  });
});
