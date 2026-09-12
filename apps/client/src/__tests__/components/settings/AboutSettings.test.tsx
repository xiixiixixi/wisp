import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AboutSettings from '@/components/settings/AboutSettings';

const mocks = vi.hoisted(() => ({
  native: false,
  useUpdater: vi.fn(),
  check: vi.fn(),
  install: vi.fn(),
  openUrl: vi.fn(),
  status: {
    available: false,
    version: undefined as string | undefined,
    downloading: false,
    progress: 0,
    error: undefined as string | undefined,
  },
}));
vi.mock('@/lib/transport', () => ({ isTauri: () => mocks.native }));
vi.mock('@/lib/tauri-api', () => ({ TauriAPI: { openUrl: mocks.openUrl } }));
vi.mock('@/hooks/use-updater', () => ({
  default: () => {
    mocks.useUpdater();
    return { status: mocks.status, checkForUpdate: mocks.check, installUpdate: mocks.install };
  },
}));

describe('AboutSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.native = false;
    mocks.status = {
      available: false,
      version: undefined,
      downloading: false,
      progress: 0,
      error: undefined,
    };
    mocks.check.mockResolvedValue(null);
    mocks.install.mockResolvedValue(undefined);
    mocks.openUrl.mockResolvedValue(undefined);
  });

  it('keeps real external links in the browser and does not mount the desktop updater', () => {
    render(<AboutSettings />);
    expect(screen.getByRole('heading', { name: 'Wisp' })).toBeVisible();
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeVisible();
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/xiixiixixi/wisp',
    );
    expect(screen.getByRole('link', { name: 'Releases' })).toHaveAttribute(
      'href',
      'https://github.com/xiixiixixi/wisp/releases',
    );
    expect(screen.getByRole('link', { name: 'Support Wisp' })).toHaveAttribute(
      'href',
      'https://github.com/sponsors/xiixiixixi',
    );
    expect(screen.getByRole('button', { name: 'Check for Updates' })).toBeEnabled();
    expect(mocks.useUpdater).not.toHaveBeenCalled();
  });

  it('keeps browser update checking available and explains the desktop requirement on activation', async () => {
    const user = userEvent.setup();
    render(<AboutSettings />);
    const button = screen.getByRole('button', { name: 'Check for Updates' });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    button.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Check for and install updates in the Wisp desktop app.',
    );
    expect(button).toBeEnabled();
    await user.click(button);
    expect(mocks.useUpdater).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(screen.queryByText("You're on the latest version")).toBeNull();
  });

  it('checks on request and prevents duplicate checks until a result arrives', async () => {
    mocks.native = true;
    let resolveCheck!: (value: null) => void;
    mocks.check.mockReturnValue(
      new Promise<null>((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<AboutSettings />);
    const button = screen.getByRole('button', { name: 'Check for Updates' });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Checking for updates');
    await user.click(button);
    expect(mocks.check).toHaveBeenCalledOnce();
    await act(async () => resolveCheck(null));
    expect(button).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent("You're on the latest version");
  });

  it('shows a failed check and allows retry', async () => {
    mocks.native = true;
    mocks.check.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<AboutSettings />);
    await user.click(screen.getByRole('button', { name: 'Check for Updates' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('failed');
    await user.click(screen.getByRole('button', { name: 'Check for Updates' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("You're on the latest version"),
    );
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it('keeps install, progress, and install failure feedback available', async () => {
    mocks.native = true;
    mocks.status.available = true;
    mocks.status.version = '9.1.0';
    const user = userEvent.setup();
    const { rerender } = render(<AboutSettings />);
    expect(screen.getByRole('status')).toHaveTextContent('9.1.0');
    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(mocks.install).toHaveBeenCalledOnce();
    mocks.status = { ...mocks.status, downloading: true, progress: 42 };
    rerender(<AboutSettings />);
    expect(screen.getByRole('button', { name: 'Update now' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('42%');
    mocks.status = { ...mocks.status, downloading: false, error: 'download failed' };
    rerender(<AboutSettings />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t install the update');
    expect(screen.getByRole('button', { name: 'Update now' })).toBeEnabled();
  });

  it('uses native URL opening and reports a rejected open without claiming success', async () => {
    mocks.native = true;
    mocks.openUrl.mockRejectedValueOnce(new Error('no handler'));
    render(<AboutSettings />);
    fireEvent.click(screen.getByRole('link', { name: 'GitHub' }));
    expect(mocks.openUrl).toHaveBeenCalledWith('https://github.com/xiixiixixi/wisp');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open the link');
    fireEvent.click(screen.getByRole('link', { name: 'GitHub' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.openUrl).toHaveBeenCalledTimes(2);
  });
});
