import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import BatchConfirmDialog from '@/components/dialogs/BatchConfirmDialog';
import type { FileEntry } from '@/lib/tauri-api';

const files: FileEntry[] = [
  {
    name: 'plan.md',
    path: '/Documents/plan.md',
    is_dir: false,
    size: 1024,
    modified: 1_700_000_000,
    file_type: 'markdown',
    is_readonly: false,
  },
  {
    name: 'notes.txt',
    path: '/Documents/notes.txt',
    is_dir: false,
    size: 2048,
    modified: 1_700_000_000,
    file_type: 'text',
    is_readonly: false,
  },
];

describe('BatchConfirmDialog', () => {
  it('defaults destructive confirmation to cancel and restores focus on Escape', async () => {
    const onConfirm = vi.fn();

    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open dialog</button>
          <BatchConfirmDialog
            isOpen={open}
            operation="delete"
            files={files}
            onConfirm={onConfirm}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    };

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    fireEvent.click(trigger);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());

    const dialog = screen.getByRole('dialog', { name: 'Delete 2 Items' });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus inside the dialog', async () => {
    render(
      <BatchConfirmDialog
        isOpen
        operation="delete"
        files={files}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete 2 Items' });
    const close = screen.getByRole('button', { name: 'Close' });
    const confirm = screen.getByRole('button', { name: 'Delete All' });
    close.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });
});
