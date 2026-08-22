import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { showInputToast, Toaster } from '@/components/ui/Toast';
import { useToast } from '@/hooks/use-toast';

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
});
