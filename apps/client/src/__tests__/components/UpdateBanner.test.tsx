import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UpdateBanner from '@/components/UpdateBanner';

const { mockUseUpdater, installUpdate, dismissUpdate } = vi.hoisted(() => ({
  mockUseUpdater: vi.fn(),
  installUpdate: vi.fn(),
  dismissUpdate: vi.fn(),
}));

vi.mock('@/hooks/use-updater', () => ({
  default: mockUseUpdater,
}));

describe('UpdateBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUpdater.mockReturnValue({
      status: {
        available: true,
        version: '1.2.3',
        downloading: false,
        progress: 0,
      },
      installUpdate,
      dismissUpdate,
    });
  });

  it('exposes an explicit close control for an available update', () => {
    render(<UpdateBanner />);

    const region = screen.getByRole('region', { name: 'Software update notification' });
    expect(region).toBeInTheDocument();
    expect(region).not.toHaveAttribute('aria-live');
    expect(screen.getByRole('status')).toHaveTextContent('Wisp 1.2.3 is available');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notification' }));

    expect(dismissUpdate).toHaveBeenCalledOnce();
  });

  it('keeps the download progress notification dismissible', () => {
    mockUseUpdater.mockReturnValue({
      status: {
        available: true,
        version: '1.2.3',
        downloading: true,
        progress: 42,
      },
      installUpdate,
      dismissUpdate,
    });

    render(<UpdateBanner />);

    expect(screen.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(
      screen.getByRole('region', { name: 'Software update notification' }),
    ).not.toHaveAttribute('aria-live');
    expect(screen.getByRole('status')).toHaveTextContent('Downloading update...');
    expect(screen.getByRole('status')).not.toHaveTextContent('42%');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notification' }));

    expect(dismissUpdate).toHaveBeenCalledOnce();
    expect(installUpdate).not.toHaveBeenCalled();
  });
});
