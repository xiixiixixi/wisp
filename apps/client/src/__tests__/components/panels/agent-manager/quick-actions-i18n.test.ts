import { describe, it, expect } from 'vitest';
import zh from '@/locales/zh.json';
import en from '@/locales/en.json';

/**
 * Quick-action prompts moved from hardcoded English to i18n — this test
 * locks in the "every new key must exist in BOTH locales with real
 * values" rule that was once broken (the xterm.* lesson).
 */
const QUICK_ACTION_IDS = [
  'organize',
  'findDuplicates',
  'generateReadme',
  'smartRename',
  'summarize',
  'cleanup',
] as const;

describe('quick action prompt i18n completeness', () => {
  for (const id of QUICK_ACTION_IDS) {
    it(`${id}Prompt exists and is non-empty in zh and en`, () => {
      const zhPrompt = (zh.agentManager?.quickActions as Record<string, string>)?.[`${id}Prompt`];
      const enPrompt = (en.agentManager?.quickActions as Record<string, string>)?.[`${id}Prompt`];
      expect(typeof zhPrompt).toBe('string');
      expect(zhPrompt!.trim().length).toBeGreaterThan(4);
      expect(typeof enPrompt).toBe('string');
      expect(enPrompt!.trim().length).toBeGreaterThan(4);
    });

    it(`${id} label key exists in zh and en`, () => {
      const zhLabel = (zh.agentManager?.quickActions as Record<string, string>)?.[id];
      const enLabel = (en.agentManager?.quickActions as Record<string, string>)?.[id];
      expect(typeof zhLabel).toBe('string');
      expect(zhLabel!.trim().length).toBeGreaterThan(0);
      expect(typeof enLabel).toBe('string');
      expect(enLabel!.trim().length).toBeGreaterThan(0);
    });
  }
});
