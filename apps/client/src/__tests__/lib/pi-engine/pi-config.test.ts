/**
 * pi-format model configuration: models.json composition + auth.json keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  models_json: { providers: {} },
  auth_status: [],
};
const authKeys: Record<string, string> = {};

vi.mock('@/lib/transport', () => ({
  isTauri: () => true,
  transport: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'pi_config_state') return { ...state, models_json: structuredClone(state.models_json) };
    if (cmd === 'pi_auth_keys') return { ...authKeys };
    if (cmd === 'pi_config_set_auth_key') {
      authKeys[args!.provider as string] = args!.apiKey as string;
      return;
    }
    throw new Error(`unexpected transport: ${cmd}`);
  }),
}));

import { STORAGE_KEYS } from '@/lib/storage-keys';
import {
  buildPiModels,
  resolveModel,
  availableModels,
  migrateLegacyProviderKeys,
  invalidatePiConfig,
} from '@/lib/pi-engine/providers';
import { transport } from '@/lib/transport';

describe('pi-format model configuration', () => {
  beforeEach(() => {
    state.models_json = { providers: {} };
    for (const k of Object.keys(authKeys)) delete authKeys[k];
    localStorage.clear();
    invalidatePiConfig();
    vi.mocked(transport).mockClear();
  });

  it('registers a models.json custom provider and streams with its auth key', async () => {
    state.models_json = {
      providers: {
        'my-llm': {
          name: 'My LLM',
          baseUrl: 'https://api.example.com/v1',
          api: 'openai-completions',
          models: [{ id: 'big-model', contextWindow: 200000, maxTokens: 16384 }],
        },
      },
    };
    authKeys['my-llm'] = 'sk-custom';

    const resolved = await resolveModel('my-llm:big-model');
    expect(resolved.apiKey).toBe('sk-custom');
    expect(resolved.model.provider).toBe('my-llm');
    expect(resolved.model.baseUrl).toBe('https://api.example.com/v1');
    expect(resolved.model.contextWindow).toBe(200000);
  });

  it('lists configured built-ins and custom providers, hides keyless ones', async () => {
    authKeys['minimax'] = 'k';
    authKeys['my-llm'] = 'k2';
    state.models_json = {
      providers: {
        'my-llm': {
          baseUrl: 'https://x/v1',
          api: 'openai-completions',
          models: [{ id: 'm1' }],
        },
        // keyless custom provider must NOT be listed
        'no-key': {
          baseUrl: 'https://y/v1',
          api: 'openai-completions',
          models: [{ id: 'm2' }],
        },
      },
    };
    const list = await availableModels();
    const refs = list.map((m) => m.ref);
    expect(refs.some((r) => r.startsWith('minimax:'))).toBe(true);
    expect(refs).toContain('my-llm:m1');
    expect(refs.some((r) => r.startsWith('deepseek:'))).toBe(false); // no key
    expect(refs.some((r) => r.startsWith('no-key:'))).toBe(false); // custom without key
    expect(refs.every((r) => !r.startsWith('ollama:'))).toBe(true); // 无内置兜底
  });

  it('override semantics: baseUrl-only entry keeps the built-in catalog', () => {
    const models = buildPiModels({
      providers: { anthropic: { baseUrl: 'https://my-proxy.example.com' } },
    });
    const catalog = models.getModels('anthropic');
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog[0].baseUrl).toBe('https://my-proxy.example.com');
  });

  it('rejects an unconfigured provider with a readable hint', async () => {
    await expect(resolveModel('deepseek:deepseek-chat')).rejects.toThrow(/模型配置/);
  });

  it('legacy localStorage keys migrate into auth.json once', async () => {
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        aiProviders: { minimax: { apiKey: 'legacy-key' }, glm: { apiKey: 'glm-key' } },
      }),
    );
    await migrateLegacyProviderKeys();
    expect(authKeys['minimax']).toBe('legacy-key');
    expect(authKeys['zai']).toBe('glm-key'); // alias glm → zai
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!);
    expect(settings.aiProviders).toBeUndefined();
  });

  it('aliases keep first-iteration references working', async () => {
    authKeys['zai'] = 'k';
    const resolved = await resolveModel('glm:glm-4.7');
    expect(resolved.model.provider).toBe('zai');
    expect(resolved.apiKey).toBe('k');
  });
});
