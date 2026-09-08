import { describe, it, expect } from 'vitest';
import { migrateLegacyAiSettings, DEFAULT_SETTINGS } from '@/components/settings/shared';

describe('migrateLegacyAiSettings', () => {
  it('migrates the dead cloud mode to custom', () => {
    const legacy = { aiServiceMode: 'cloud', theme: 'glass' };
    const migrated = migrateLegacyAiSettings(legacy);
    expect(migrated.aiServiceMode).toBe('custom');
    // Appearance also resolves to the single supported theme.
    expect(migrated.theme).toBe('auto');
  });

  it('preserves custom provider settings without mutating the profile', () => {
    const current = { aiServiceMode: 'custom', theme: 'auto', aiCustomModel: 'my-model' };
    expect(migrateLegacyAiSettings(current)).toEqual(current);
  });

  it('normalizes old appearance even without an AI mode', () => {
    const bare = { theme: 'glass' };
    expect(migrateLegacyAiSettings(bare)).toEqual({ theme: 'auto' });
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
