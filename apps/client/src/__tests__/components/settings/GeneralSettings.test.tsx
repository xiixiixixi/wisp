import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GeneralSettings from '@/components/settings/GeneralSettings';
import { DEFAULT_SETTINGS } from '@/components/settings/shared';

vi.mock('@/lib/transport', () => ({ isTauri: () => false }));
vi.mock('@/components/settings/AboutSettings', () => ({
  default: () => <section aria-label="About">Wisp</section>,
}));
vi.mock('@/components/settings/ShortcutsSettings', () => ({
  default: () => <button>Customize keyboard shortcuts</button>,
}));

const props = {
  settings: { ...DEFAULT_SETTINGS, appearance: 'system' as const },
  updateSetting: vi.fn(),
  setSettings: vi.fn(),
};

describe('GeneralSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mounts keyboard controls only while their disclosure is open', async () => {
    const user = userEvent.setup();
    render(<GeneralSettings {...props} />);
    const summary = screen.getByText('Keyboard').closest('summary')!;
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('button', { name: 'Customize keyboard shortcuts' })).toBeNull();
    await user.click(summary);
    expect(
      await screen.findByRole('button', { name: 'Customize keyboard shortcuts' }),
    ).toBeVisible();
    await user.click(summary);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Customize keyboard shortcuts' })).toBeNull(),
    );
  });

  it('confirms the reset scope and retains service credentials and unrelated preferences', async () => {
    const user = userEvent.setup();
    const settings = {
      ...props.settings,
      aiCustomApiKey: 'keep-key',
      weatherCity: 'keep-city',
      showHiddenFiles: true,
      defaultView: 'grid',
    };
    render(<GeneralSettings {...props} settings={settings} />);
    expect(screen.queryByText('Advanced')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Restore default preferences' }));
    expect(props.setSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Restore defaults', exact: true }));
    expect(props.setSettings).toHaveBeenCalledWith({
      ...settings,
      defaultView: DEFAULT_SETTINGS.defaultView,
    });
  });

  it('retains appearance and language controls with About in the same view', async () => {
    const user = userEvent.setup();
    render(<GeneralSettings {...props} />);
    expect(screen.getByRole('radio', { name: 'Follow system' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(props.updateSetting).toHaveBeenCalledWith('appearance', 'dark');
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'About' })).toBeVisible();
    expect(screen.queryByText('System Integration')).toBeNull();
  });
});
