import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import JsonPreview from '@/components/previews/JsonPreview';
import { FileConflictDialog } from '@/components/dialogs/FileConflictDialog';
import { FileReferenceBadge } from '@/components/explorer/FileReferenceBadge';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { getAppLocale, formatAppDuration } from '@/lib/locale';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { fileTypeLabel } from '@/lib/file-type-label';
import { getLabelForAction } from '@/lib/shortcut-utils';

vi.unmock('react-i18next');

const file: FileEntry = {
  name: '报告.json',
  path: '/Documents/报告.json',
  size: 10,
  modified: 0,
  is_dir: false,
  file_type: 'json',
  is_readonly: false,
};
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('zh');
});

describe('live language switching', () => {
  it('persists the choice and updates document/formatting locales', async () => {
    expect(document.documentElement.lang).toBe('en');
    expect(getAppLocale()).toBe('en-US');
    expect(formatAppDuration(300)).toBe('5 minutes');
    expect(formatAppDuration(60)).toBe('1 minute');
    expect(Object.keys(i18n.options.resources!)).toEqual(['en', 'zh']);
    await i18n.changeLanguage('zh');
    expect(document.documentElement.lang).toBe('zh');
    expect(getAppLocale()).toBe('zh-CN');
    expect(formatAppDuration(300)).toBe('5分钟');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).language).toBe('zh');
  });

  it('updates an already-open conflict dialog without changing the filename', async () => {
    render(
      <FileConflictDialog
        isOpen
        fileName="报告.json"
        isDir={false}
        destination="/Documents"
        remaining={2}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText('Remaining conflicts: 2')).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage('zh');
    });
    expect(screen.getByText('剩余 2 个冲突')).toBeInTheDocument();
    expect(screen.getByText('报告.json')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保留两个文件' })).toBeInTheDocument();
  });

  it('updates existing preview errors without reading the file again', async () => {
    vi.mocked(TauriAPI.readTextFile).mockResolvedValue('invalid json');
    render(<JsonPreview file={file} />);
    await waitFor(() => expect(screen.getByText('Invalid JSON format')).toBeInTheDocument());
    const calls = vi.mocked(TauriAPI.readTextFile).mock.calls.length;
    await act(async () => {
      await i18n.changeLanguage('zh');
    });
    expect(screen.getByText('JSON 格式无效')).toBeInTheDocument();
    expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(calls);
  });

  it('updates assistive labels while preserving link targets', async () => {
    render(
      <FileReferenceBadge file={{ ...file, is_symlink: true, symlink_target: '/原件/报告.json' }}>
        icon
      </FileReferenceBadge>,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName('Symbolic link to /原件/报告.json');
    await act(async () => {
      await i18n.changeLanguage('zh');
    });
    expect(screen.getByRole('img')).toHaveAccessibleName('符号链接，指向 /原件/报告.json');
  });

  it('localizes lowercase file metadata and parameterized shortcut actions', async () => {
    expect(fileTypeLabel('text', i18n.t.bind(i18n))).toBe('Text document');
    await i18n.changeLanguage('zh');
    expect(fileTypeLabel('Text', i18n.t.bind(i18n))).toBe('文本文档');
    expect(fileTypeLabel('presentation', i18n.t.bind(i18n))).toBe('演示文稿');
    expect(getLabelForAction({ GoToSpecial: { folder: 'desktop' } })).toBe('前往桌面');
    expect(getLabelForAction({ SetViewMode: { mode: 'column' } })).not.toMatch(/[A-Za-z]/);
  });
});
