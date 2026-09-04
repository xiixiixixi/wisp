import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfirmationToast,
  InputToast,
  showConfirmationToast,
  showInputToast,
  Toaster,
} from '@/components/ui/Toast';
import { toast, useToast } from '@/hooks/use-toast';
import zh from '@/locales/zh.json';

const clearToasts = () => {
  const { result, unmount } = renderHook(() => useToast());
  act(() => result.current.remove());
  unmount();
};

describe('interactive toast dialogs', () => {
  beforeEach(clearToasts);
  afterEach(clearToasts);

  it('keeps invalid input in context and only submits a valid name', async () => {
    render(<Toaster />);

    let resultPromise!: Promise<string | null>;
    act(() => {
      resultPromise = showInputToast({
        title: 'New folder',
        placeholder: 'Folder name',
        submitText: 'Create',
        cancelText: 'Cancel',
        validate: (value) => (value.includes('/') ? 'Names cannot contain /.' : undefined),
      });
    });

    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close notification' })).toHaveAttribute(
      'title',
      'Close notification',
    );
    const input = screen.getByRole('textbox');
    const submit = screen.getByRole('button', { name: 'Create' });
    expect(input).toHaveFocus();
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: 'bad/name' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Names cannot contain /.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: 'Projects' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await expect(resultPromise).resolves.toBe('Projects');
  });

  it('resolves Escape as cancellation and restores focus', async () => {
    render(
      <>
        <button type="button">Open creator</button>
        <Toaster />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Open creator' });
    trigger.focus();

    let resultPromise!: Promise<string | null>;
    act(() => {
      resultPromise = showInputToast({ title: 'Rename', initialValue: 'notes.md' });
    });
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());

    fireEvent.keyDown(document, { key: 'Escape' });

    await expect(resultPromise).resolves.toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('falls back to the global command trigger when the original control unmounts', async () => {
    render(
      <>
        <button type="button" data-command-palette-trigger>
          Open command center
        </button>
        <Toaster />
      </>,
    );
    const commandTrigger = screen.getByRole('button', { name: 'Open command center' });
    const transientTrigger = document.createElement('button');
    document.body.appendChild(transientTrigger);
    transientTrigger.focus();

    let resultPromise!: Promise<string | null>;
    act(() => {
      resultPromise = showInputToast({ title: 'New folder' });
    });
    transientTrigger.remove();
    fireEvent.keyDown(document, { key: 'Escape' });

    await expect(resultPromise).resolves.toBeNull();
    await waitFor(() => expect(commandTrigger).toHaveFocus());
  });

  it('does not restore focus to the document body after a palette action closes', async () => {
    render(
      <>
        <button type="button" data-command-palette-trigger>
          Open command center
        </button>
        <Toaster />
      </>,
    );
    const commandTrigger = screen.getByRole('button', { name: 'Open command center' });

    let resultPromise!: Promise<string | null>;
    act(() => {
      resultPromise = showInputToast({ title: 'New folder' });
    });
    fireEvent.keyDown(document, { key: 'Escape' });

    await expect(resultPromise).resolves.toBeNull();
    await waitFor(() => expect(commandTrigger).toHaveFocus());
  });

  it('uses translated default actions for confirmation dialogs', async () => {
    render(<Toaster />);

    let resultPromise!: Promise<boolean>;
    act(() => {
      resultPromise = showConfirmationToast({ title: 'Delete file?' });
    });

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));

    await expect(resultPromise).resolves.toBe(false);
  });

  it('keeps an input dialog alive while ordinary notifications roll over their limit', async () => {
    render(<Toaster />);

    let resultPromise!: Promise<string | null>;
    act(() => {
      resultPromise = showInputToast({ title: 'Create protected folder' });
      toast({ title: 'Notice 1', autoDismiss: false });
      toast({ title: 'Notice 2', autoDismiss: false });
      toast({ title: 'Notice 3', autoDismiss: false });
      toast({ title: 'Notice 4', autoDismiss: false });
    });

    expect(screen.getByRole('dialog', { name: 'Create protected folder' })).toBeInTheDocument();
    expect(screen.queryByText('Notice 1')).not.toBeInTheDocument();
    expect(screen.getByText('Notice 2')).toBeInTheDocument();
    expect(screen.getByText('Notice 3')).toBeInTheDocument();
    expect(screen.getByText('Notice 4')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Projects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await expect(resultPromise).resolves.toBe('Projects');
  });

  it('settles the previous dialog when a new interactive dialog replaces it', async () => {
    render(<Toaster />);

    let inputPromise!: Promise<string | null>;
    let confirmationPromise!: Promise<boolean>;
    act(() => {
      inputPromise = showInputToast({ title: 'First dialog' });
      confirmationPromise = showConfirmationToast({ title: 'Replacement dialog' });
    });

    await expect(inputPromise).resolves.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'First dialog' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Replacement dialog' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(confirmationPromise).resolves.toBe(true);
  });

  it('settles an interactive dialog when it is dismissed programmatically', async () => {
    render(<Toaster />);
    const { result } = renderHook(() => useToast());

    let resultPromise!: Promise<string | null>;
    act(() => {
      resultPromise = showInputToast({ title: 'Programmatic close' });
    });

    expect(screen.getByRole('dialog', { name: 'Programmatic close' })).toBeInTheDocument();
    act(() => result.current.dismiss());

    await expect(resultPromise).resolves.toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Programmatic close' })).not.toBeInTheDocument(),
    );
  });
});

describe('shared toast close controls', () => {
  beforeEach(clearToasts);
  afterEach(clearToasts);

  it('adds an accessible close control to every notification and dismisses only its item', async () => {
    render(<Toaster />);
    act(() => {
      toast({ title: 'First notification', autoDismiss: false });
      toast({ title: 'Second notification', autoDismiss: false });
    });

    const closeButtons = screen.getAllByRole('button', { name: 'Close notification' });
    expect(closeButtons).toHaveLength(2);
    closeButtons.forEach((button) => expect(button).toHaveAttribute('title', 'Close notification'));

    fireEvent.click(closeButtons[0]);
    await waitFor(() => expect(screen.queryByText('Second notification')).not.toBeInTheDocument());
    expect(screen.getByText('First notification')).toBeInTheDocument();
  });

  it('gives the reusable confirmation and input variants close controls and translated defaults', () => {
    const cancelConfirmation = vi.fn();
    const { rerender } = render(
      <ConfirmationToast
        title="Confirm action"
        onConfirm={vi.fn()}
        onCancel={cancelConfirmation}
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    expect(cancelConfirmation).toHaveBeenCalledOnce();

    const cancelInput = vi.fn();
    rerender(<InputToast title="Create item" onSubmit={vi.fn()} onCancel={cancelInput} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    expect(cancelInput).toHaveBeenCalledOnce();
  });

  it('ships Chinese accessible and default action labels', () => {
    expect(zh.toast.closeNotification).toBe('关闭通知');
    expect(zh.common.confirm).toBe('确认');
    expect(zh.common.create).toBe('创建');
    expect(zh.common.cancel).toBe('取消');
  });
});
