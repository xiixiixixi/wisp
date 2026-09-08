import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { isTauri, transport } from '@/lib/transport';
import { installNativeMenuLanguage } from '@/lib/native-menu-language';

vi.mock('@/lib/transport', () => ({
  isTauri: vi.fn(() => true),
  transport: vi.fn(async () => undefined),
}));
vi.mock('@/lib/shortcut-utils', () => ({ isMacPlatform: () => true }));
let dispose = () => {};
afterEach(() => {
  dispose();
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe('native menu language', () => {
  it('synchronizes on startup and language changes, and unsubscribes on disposal', async () => {
    await i18n.changeLanguage('zh');
    dispose = installNativeMenuLanguage();
    expect(transport).toHaveBeenLastCalledWith('set_app_menu_language', { language: 'zh' });
    await i18n.changeLanguage('en');
    expect(transport).toHaveBeenLastCalledWith('set_app_menu_language', { language: 'en' });
    dispose();
    vi.mocked(transport).mockClear();
    await i18n.changeLanguage('zh');
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not call native menus in the browser', () => {
    vi.mocked(isTauri).mockReturnValue(false);
    dispose = installNativeMenuLanguage();
    expect(transport).not.toHaveBeenCalled();
  });
});
