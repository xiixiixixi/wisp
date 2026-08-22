import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetaWarningDialog, {
  isBetaWarningDismissed,
  resetBetaWarning,
} from '@/components/dialogs/BetaWarningDialog';

describe('BetaWarningDialog', () => {
  beforeEach(() => {
    resetBetaWarning();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetBetaWarning();
  });

  const openDialog = () => {
    render(<BetaWarningDialog />);
    act(() => vi.advanceTimersByTime(400));
  };

  it('introduces the product before showing the preview caution', () => {
    openDialog();

    expect(screen.getByRole('dialog', { name: 'Welcome to Wisp' })).toBeInTheDocument();
    expect(screen.getByText('Your intelligent file workspace')).toBeInTheDocument();
    expect(
      screen.getByText('Search files, commands, and actions from one place'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Preview, organize, and automate everyday file work'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Keep every change visible, recoverable, and under your control'),
    ).toBeInTheDocument();
    expect(screen.getByText('Preview release')).toBeInTheDocument();
  });

  it('focuses the primary action and remembers dismissal', () => {
    openDialog();

    const enterButton = screen.getByRole('button', { name: 'Enter workspace' });
    expect(enterButton).toHaveFocus();
    fireEvent.click(enterButton);

    expect(isBetaWarningDismissed()).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports Escape as a complete dismissal path', () => {
    openDialog();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(isBetaWarningDismissed()).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
