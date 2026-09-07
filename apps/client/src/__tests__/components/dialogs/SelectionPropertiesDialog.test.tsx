import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SelectionPropertiesDialog from '@/components/dialogs/SelectionPropertiesDialog';
import i18n from '@/i18n';
import type { FileEntry } from '@/lib/tauri-api';
vi.unmock('react-i18next');

const files: FileEntry[] = [
  {
    name: 'Plan.txt',
    path: '/work/Plan.txt',
    size: 1024,
    is_dir: false,
    is_readonly: false,
    modified: 1,
    file_type: 'text',
  },
  {
    name: 'Folder',
    path: '/work/Folder',
    size: 99999,
    is_dir: true,
    is_readonly: false,
    modified: 1,
    file_type: 'folder',
  },
];
describe('selection properties', () => {
  it('lists every file and folder without treating directory entry sizes as content sizes', () => {
    render(<SelectionPropertiesDialog files={files} onClose={vi.fn()} onCopyPaths={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveStyle({ maxWidth: '32rem' });
    expect(screen.getByText('/work/Plan.txt')).toBeInTheDocument();
    expect(screen.getByText('/work/Folder')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('selectionProperties.fileBytes'))).toBeInTheDocument();
    expect(screen.getAllByText('1024 B')).toHaveLength(2);
  });
  it('copies all paths and closes through the shared accessible dialog', () => {
    const copy = vi.fn();
    const close = vi.fn();
    render(<SelectionPropertiesDialog files={files} onClose={close} onCopyPaths={copy} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('selectionProperties.copyPaths') }));
    expect(copy).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
