import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PropertiesPanel from '@/components/panels/PropertiesPanel';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getDetailedFileProperties: mocks.load,
    setFilePermissions: mocks.save,
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

const properties = (name: string) => ({
  path: `/files/${name}`,
  name,
  file_type: 'Text',
  size: 10,
  size_formatted: '10 B',
  created: 1710000000,
  modified: 1710000000,
  accessed: 1710000000,
  permissions: { readable: true, writable: true, executable: false, permissions_string: '644' },
  is_directory: false,
  is_hidden: false,
  is_readonly: false,
  attributes: {},
});

describe('PropertiesPanel', () => {
  beforeEach(() => vi.resetAllMocks());

  it('keeps the latest selected file when an earlier read finishes late', async () => {
    let finishFirst!: (value: ReturnType<typeof properties>) => void;
    mocks.load.mockImplementation((path: string) =>
      path.endsWith('first.txt')
        ? new Promise((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve(properties('second.txt')),
    );
    const { rerender } = render(<PropertiesPanel filePath="/files/first.txt" />);
    rerender(<PropertiesPanel filePath="/files/second.txt" />);
    expect(await screen.findByText('second.txt')).toBeInTheDocument();
    await act(async () => finishFirst(properties('first.txt')));
    expect(screen.queryByText('first.txt')).not.toBeInTheDocument();
    expect(screen.getByText('second.txt')).toBeInTheDocument();
  });

  it('reports string errors and can retry the current file', async () => {
    mocks.load.mockRejectedValueOnce('Permission denied').mockResolvedValue(properties('file.txt'));
    render(<PropertiesPanel filePath="/files/file.txt" />);
    expect(await screen.findByText(/Permission denied/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('file.txt')).toBeInTheDocument();
  });

  it('keeps permission edits after a failed save and prevents repeat submission', async () => {
    mocks.load.mockResolvedValue(properties('file.txt'));
    let rejectSave!: (reason: string) => void;
    mocks.save.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    render(<PropertiesPanel filePath="/files/file.txt" />);
    await screen.findByText('file.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '600' } });
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith('/files/file.txt', '600');
    expect(input).toBeDisabled();
    await act(async () => rejectSave('Read-only volume'));
    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue('600');
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: expect.stringContaining('Read-only volume'),
      }),
    );
  });
});
