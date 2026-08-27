import { describe, it, expect } from 'vitest';
import { migrateLegacyAiSettings, DEFAULT_SETTINGS } from '@/components/settings/shared';

describe('migrateLegacyAiSettings', () => {
  it('migrates the dead cloud mode to custom', () => {
    const legacy = { aiServiceMode: 'cloud', theme: 'glass' };
    const migrated = migrateLegacyAiSettings(legacy);
    expect(migrated.aiServiceMode).toBe('custom');
    // untouched fields survive
    expect(migrated.theme).toBe('glass');
  });

  it('leaves custom profiles untouched (same reference)', () => {
    const current = { aiServiceMode: 'custom', theme: 'glass' };
    expect(migrateLegacyAiSettings(current)).toBe(current);
  });

  it('leaves profiles without the key untouched', () => {
    const bare = { theme: 'glass' };
    expect(migrateLegacyAiSettings(bare)).toBe(bare);
  });

  it('does not mutate the input object', () => {
    const legacy = { aiServiceMode: 'cloud' };
    migrateLegacyAiSettings(legacy);
    expect(legacy.aiServiceMode).toBe('cloud');
  });

  it('factory defaults ship custom mode (no dead cloud default)', () => {
    expect(DEFAULT_SETTINGS.aiServiceMode).toBe('custom');
  });
});
