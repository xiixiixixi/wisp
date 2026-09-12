import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openRecentEntry, parentDirectory, resolveEntryPath } from '@/lib/recent-entry-actions';
import { TauriAPI } from '@/lib/tauri-api';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    openFile: vi.fn(),
    addRecentFile: vi.fn(),
    isDir: vi.fn(),
    getUserDirectories: vi.fn(async () => ({ home: '/Users/test' })),
  },
}));
vi.mock('@/lib/browser-demo-files', async (original) => ({
  ...(await original<typeof import('@/lib/browser-demo-files')>()),
  isBrowserDemoMode: vi.fn(() => false),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isBrowserDemoMode).mockReturnValue(false);
});

describe('successful recent entry actions', () => {
  it('records only after the system opener resolves', async () => {
    let finish!: () => void;
    vi.mocked(TauriAPI.openFile).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const navigate = vi.fn();
    const opening = openRecentEntry({ path: '/Projects/notes.md', isDir: false }, navigate);
    await Promise.resolve();
    expect(TauriAPI.openFile).toHaveBeenCalledWith('/Projects/notes.md');
    expect(TauriAPI.addRecentFile).not.toHaveBeenCalled();
    finish();
    await opening;
    expect(TauriAPI.addRecentFile).toHaveBeenCalledWith('/Projects/notes.md');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not record failed opens', async () => {
    vi.mocked(TauriAPI.openFile).mockRejectedValueOnce(new Error('Permission denied'));
    await expect(openRecentEntry({ path: '/private/file', isDir: false }, vi.fn())).rejects.toThrow(
      'Permission denied',
    );
    expect(TauriAPI.addRecentFile).not.toHaveBeenCalled();
  });

  it('does not misreport an opened file when history persistence fails', async () => {
    vi.mocked(TauriAPI.addRecentFile).mockRejectedValueOnce(new Error('Disk full'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      openRecentEntry({ path: '/notes.txt', isDir: false }, vi.fn()),
    ).resolves.toBeUndefined();
    warning.mockRestore();
  });

  it('navigates directories and leaves recording to the successful pane read', async () => {
    const navigate = vi.fn();
    await openRecentEntry({ path: '/Projects', isDir: true }, navigate);
    expect(navigate).toHaveBeenCalledWith('/Projects');
    expect(TauriAPI.openFile).not.toHaveBeenCalled();
    expect(TauriAPI.addRecentFile).not.toHaveBeenCalled();
  });

  it('classifies a pasted file path instead of navigating to it as a folder', async () => {
    vi.mocked(TauriAPI.isDir).mockResolvedValueOnce(false);
    const navigate = vi.fn();
    await openRecentEntry({ path: '~/Documents/中文 notes.txt' }, navigate);
    expect(TauriAPI.isDir).toHaveBeenCalledTimes(1);
    expect(TauriAPI.isDir).toHaveBeenCalledWith('/Users/test/Documents/中文 notes.txt');
    expect(TauriAPI.openFile).toHaveBeenCalledWith('/Users/test/Documents/中文 notes.txt');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps explicit virtual navigation out of file opening and history', async () => {
    const navigate = vi.fn();
    await openRecentEntry({ path: 'wisp://home', isDir: true }, navigate);
    expect(navigate).toHaveBeenCalledWith('wisp://home');
    expect(TauriAPI.isDir).not.toHaveBeenCalled();
    expect(TauriAPI.addRecentFile).not.toHaveBeenCalled();
  });

  it('handles a home-only pasted path', async () => {
    expect(await resolveEntryPath('~')).toBe('/Users/test');
  });

  it('uses the existing preview in demo without calling the system opener', async () => {
    vi.mocked(isBrowserDemoMode).mockReturnValue(true);
    const preview = vi.fn();
    const navigate = vi.fn();
    await openRecentEntry({ path: '/home/user/Documents/Q3-launch-plan.md' }, navigate, {
      openDemoFile: preview,
    });
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/user/Documents/Q3-launch-plan.md' }),
    );
    expect(TauriAPI.openFile).not.toHaveBeenCalled();
    expect(TauriAPI.addRecentFile).toHaveBeenCalledWith('/home/user/Documents/Q3-launch-plan.md');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not pretend a demo reveal was a file open when no preview is supplied', async () => {
    vi.mocked(isBrowserDemoMode).mockReturnValue(true);
    const navigate = vi.fn();
    await openRecentEntry({ path: '/home/user/Documents/Q3-launch-plan.md' }, navigate);
    expect(navigate).toHaveBeenCalledWith('/home/user/Documents');
    expect(TauriAPI.openFile).not.toHaveBeenCalled();
    expect(TauriAPI.addRecentFile).not.toHaveBeenCalled();
  });
});

describe('parent directories for reveal', () => {
  it.each([
    ['/notes.txt', '/'],
    ['/', '/'],
    ['/Volumes/Work/中文 文件', '/Volumes/Work'],
    ['/Users/tc/folder/', '/Users/tc'],
    ['C:\\notes.txt', 'C:\\'],
    ['C:\\', 'C:\\'],
    ['C:/notes.txt', 'C:/'],
    ['\\\\server\\share\\file.txt', '\\\\server\\share'],
    ['\\\\server\\share\\', '\\\\server\\share'],
  ])('%s reveals in %s', (input, expected) => expect(parentDirectory(input)).toBe(expected));
});
