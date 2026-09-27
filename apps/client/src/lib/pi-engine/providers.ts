/**
 * pi-engine provider registry.
 *
 * Model configuration follows pi's own form: built-in pi-ai providers plus
 * user declarations in ~/.pi/agent/models.json, credentials in
 * ~/.pi/agent/auth.json (read via the backend). A models.json entry with
 * `models` registers a new provider; one with only baseUrl/headers overrides
 * the built-in with the same id — pi's composition semantics.
 *
 * Model references are "<providerId>:<modelId>".
 */
import {
  createModels,
  createProvider,
  type Model,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { minimaxProvider } from '@earendil-works/pi-ai/providers/minimax';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai';
import { moonshotaiProvider } from '@earendil-works/pi-ai/providers/moonshotai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { transport, isTauri } from '@/lib/transport';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { piFetch, type PiFetch } from './fetch';
import { piAuthKeys, type ModelsJson, type PiProviderConfig, type PiConfigStateDto } from './pi-config';

export interface ResolvedModel {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>;
  /** The registry the model belongs to — used as the streamFn collection. */
  models: MutableModels;
  /** Explicit per-request API key (browser pi-ai cannot read env/auth files). */
  apiKey?: string;
  label: string;
}

/** Built-in providers registered in every collection. */
const BUILTIN_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'openrouter',
  'minimax',
  'deepseek',
  'zai',
  'moonshotai',
] as const;

/** Friendly display names for the settings page. */
export const BUILTIN_PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  minimax: 'MiniMax',
  deepseek: 'DeepSeek',
  zai: '智谱 GLM',
  moonshotai: 'Kimi (月之暗面)',
};

const ollamaBaseUrl = (): string =>
  localStorage.getItem(STORAGE_KEYS.OLLAMA_URL) || 'http://localhost:11434';

const normalizeOpenaiEndpoint = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('chat/completions')) return trimmed;
  return `${trimmed}/v1`;
};

const normalizeAnthropicEndpoint = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/messages')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
};

const apiImplFor = (api: string) => {
  switch (api) {
    case 'openai-completions':
      return openAICompletionsApi();
    case 'openai-responses':
      return openAIResponsesApi();
    case 'anthropic-messages':
      return anthropicMessagesApi();
    default:
      return null;
  }
};

/** Valid wire protocols a models.json provider may declare. */
export const SUPPORTED_API_TYPES = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const;

interface CachedConfig {
  models: ModelsJson;
  keys: Record<string, string>;
  loadedAt: number;
}

const CONFIG_TTL_MS = 5_000;
let cachedConfig: CachedConfig | null = null;
let pendingConfig: Promise<CachedConfig> | null = null;

const fetchConfig = (): Promise<CachedConfig> => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('pi config timeout')), 2500),
  );
  return (async () => {
    if (!isTauri()) return { models: { providers: {} }, keys: {}, loadedAt: Date.now() };
    const [models, keys] = await Promise.all([
      Promise.race([
        transport<PiConfigStateDto>('pi_config_state').then(
          (s) => s.models_json ?? { providers: {} },
        ),
        timeout,
      ]).catch(() => ({ providers: {} }) as ModelsJson),
      Promise.race([piAuthKeys(), timeout]).catch(() => ({}) as Record<string, string>),
    ]);
    return { models, keys, loadedAt: Date.now() };
  })();
};

/** Load models.json + auth keys (cached briefly; time-boxed against stalls). */
export const loadPiConfig = (force = false): Promise<CachedConfig> => {
  if (!force && cachedConfig && Date.now() - cachedConfig.loadedAt < CONFIG_TTL_MS) {
    return Promise.resolve(cachedConfig);
  }
  if (!force && pendingConfig) return pendingConfig;
  pendingConfig = fetchConfig().finally(() => {
    pendingConfig = null;
  });
  cachedConfig = null;
  return pendingConfig.then((cfg) => {
    cachedConfig = cfg;
    return cfg;
  });
};

/** Forget cached config (after settings edits). */
export const invalidatePiConfig = (): void => {
  cachedConfig = null;
  pendingConfig = null;
};

/** Auth keys resolved the pi way (auth.json first, env second). */
export const providerKeys = async (): Promise<Record<string, string>> =>
  (await loadPiConfig()).keys;

/** Build the full registry: built-ins + models.json customs/overrides. */
export const buildPiModels = (config?: ModelsJson): MutableModels => {
  const models = createModels();
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  models.setProvider(openrouterProvider());
  models.setProvider(minimaxProvider());
  models.setProvider(deepseekProvider());
  models.setProvider(zaiProvider());
  models.setProvider(moonshotaiProvider());

  if (config) {
    for (const [id, providerCfg] of Object.entries(config.providers)) {
      applyModelsJsonProvider(models, id, providerCfg);
    }
  }
  return models;
};

/** pi composition: models? new provider : override of the same-id built-in. */
const applyModelsJsonProvider = (
  models: MutableModels,
  id: string,
  cfg: PiProviderConfig,
): void => {
  if (cfg.models && cfg.models.length > 0) {
    const api = cfg.api ?? cfg.models[0]?.api;
    if (!api) return;
    const impl = apiImplFor(api);
    if (!impl) return; // unsupported protocol — skipped, surfaced in settings
    models.setProvider(
      createProvider({
        id,
        name: cfg.name ?? id,
        baseUrl: cfg.baseUrl,
        auth: {
          apiKey: { name: cfg.name ?? id, resolve: async () => ({ auth: {} }) },
        },
        models: cfg.models.map((m) => toPiModel(id, m, cfg)),
        api: impl,
      }),
    );
    return;
  }

  // Override: keep the built-in catalog, swap baseUrl. Adapters read
  // model.baseUrl (model-level wins), so the override must rewrite it.
  const existing = models.getProvider(id);
  if (!existing) return;
  const catalog = models
    .getModels(id)
    .map((m) => ({ ...m, baseUrl: cfg.baseUrl ?? m.baseUrl })) as Model<string>[];
  if (catalog.length === 0) return;
  const api = cfg.api ?? (catalog[0].api as string);
  const impl = apiImplFor(api);
  if (!impl) return;
  models.setProvider(
    createProvider({
      id,
      name: cfg.name ?? existing.name,
      baseUrl: cfg.baseUrl,
      auth: existing.auth,
      models: catalog,
      api: impl,
    }),
  );
};

const toPiModel = (
  providerId: string,
  m: NonNullable<PiProviderConfig['models']>[number],
  cfg: PiProviderConfig,
): Model<string> => {
  const api = (m.api ?? cfg.api) as string;
  const baseUrl =
    m.baseUrl ??
    cfg.baseUrl ??
    (api === 'anthropic-messages'
      ? normalizeAnthropicEndpoint(cfg.baseUrl ?? '')
      : normalizeOpenaiEndpoint(cfg.baseUrl ?? ''));
  return {
    id: m.id,
    name: m.name ?? m.id,
    api,
    provider: providerId,
    baseUrl,
    reasoning: m.reasoning ?? false,
    ...(m.thinkingLevel ? { thinkingLevel: m.thinkingLevel } : {}),
    input: m.input ?? ['text'],
    cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow ?? 128_000,
    maxTokens: m.maxTokens ?? 8_192,
  };
};

/** Resolve "<provider>:<model>" (or a legacy alias) to a runnable model. */
export const resolveModel = async (reference: string): Promise<ResolvedModel> => {
  const config = await loadPiConfig();
  const models = buildPiModels(config.models);

  // Legacy aliases from the first iteration keep working.
  const aliasMap: Record<string, string> = {
    glm: 'zai',
    kimi: 'moonshotai',
    custom: 'custom-openai',
  };
  let providerId = reference.includes(':') ? reference.split(':')[0] : '';
  const modelId = reference.includes(':') ? reference.slice(providerId.length + 1) : reference;
  providerId = aliasMap[providerId] ?? providerId;

  // Bare legacy names route by prefix rules; anything else is unconfigured.
  if (!providerId) {
    if (modelId.startsWith('claude-')) providerId = 'anthropic';
    else if (/^(gpt-|o[134]|chatgpt-)/.test(modelId)) providerId = 'openai';
    else {
      throw new Error(`模型「${modelId}」未配置。先在 设置 → AI 里添加它所在的服务。`);
    }
  }

  // Local ollama is a virtual provider, registered on demand.
  if (providerId === 'ollama') {
    const baseUrl = `${ollamaBaseUrl().replace(/\/+$/, '')}/v1`;
    const model: Model<'openai-completions'> = {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: 'ollama',
      baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 32_000,
    };
    models.setProvider(
      createProvider({
        id: 'ollama',
        name: 'Ollama',
        baseUrl,
        auth: { apiKey: { name: 'Ollama', resolve: async () => ({ auth: {} }) } },
        models: [model],
        api: openAICompletionsApi(),
      }),
    );
    return { model, models, label: modelId };
  }

  const providerLabel = BUILTIN_PROVIDER_LABELS[providerId] ?? providerId;
  const authKey = config.keys[providerId];
  const literalKey = config.models.providers[providerId]?.apiKey;
  const usableLiteral =
    literalKey && literalKey !== '$WISP_KEEP_KEY$' ? literalKey : undefined;
  if (!authKey && !usableLiteral) {
    const hint = (BUILTIN_PROVIDER_IDS as readonly string[]).includes(providerId as never)
      ? `请到 设置 → AI → 模型配置 里为 ${providerLabel} 填入 API 钥匙。`
      : `provider「${providerId}」没有配置钥匙（auth.json 或 models.json 的 apiKey）。`;
    throw new Error(hint);
  }

  const catalog = models.getModel(providerId, modelId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: Model<any> = catalog ?? ({
    id: modelId,
    name: modelId,
    api:
      providerId === 'anthropic' || providerId === 'minimax'
        ? 'anthropic-messages'
        : 'openai-completions',
    provider: providerId,
    baseUrl: undefined,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_192,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as Model<any>);
  if (!catalog) {
    models.setProvider(
      createProvider({
        id: providerId,
        name: providerLabel,
        auth: { apiKey: { name: providerLabel, resolve: async () => ({ auth: {} }) } },
        models: [model],
        api: apiImplFor(String(model.api)) ?? openAICompletionsApi(),
      }),
    );
  }
  return {
    model,
    models,
    apiKey: authKey ?? usableLiteral,
    label: modelId,
  };
};

/** A pickable model entry for the chat picker. */
export interface AvailableModel {
  /** Engine-ready reference, e.g. "minimax:MiniMax-M2.7". */
  ref: string;
  label: string;
  providerLabel: string;
}

/**
 * Models runnable right now: configured built-ins (auth.json key or
 * override), custom providers from models.json, plus local Ollama.
 */
export const availableModels = async (): Promise<AvailableModel[]> => {
  const config = await loadPiConfig();
  const models = buildPiModels(config.models);
  const out: AvailableModel[] = [];

  for (const providerId of BUILTIN_PROVIDER_IDS) {
    const override = config.models.providers[providerId];
    if (!config.keys[providerId] && !override?.apiKey && !override?.baseUrl) continue;
    const label = BUILTIN_PROVIDER_LABELS[providerId] ?? providerId;
    for (const m of models.getModels(providerId).slice(0, 4)) {
      out.push({ ref: `${providerId}:${m.id}`, label: m.name || m.id, providerLabel: label });
    }
  }

  for (const [id, cfg] of Object.entries(config.models.providers)) {
    if (!cfg.models?.length) continue;
    if (!(config.keys[id] || cfg.apiKey)) continue;
    const label = cfg.name ?? id;
    for (const m of cfg.models.slice(0, 6)) {
      out.push({ ref: `${id}:${m.id}`, label: m.name ?? m.id, providerLabel: label });
    }
  }

  // 没有内置兜底项——列表里只有用户真正配置过的模型。
  return out;
};

/** Legacy localStorage keys from the first iteration → auth.json, once. */
export const migrateLegacyProviderKeys = async (): Promise<void> => {
  if (!isTauri()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return;
    const s = JSON.parse(raw) as Record<string, unknown>;
    const legacy = s.aiProviders as Record<string, { apiKey?: string }> | undefined;
    if (!legacy) return;
    const alias: Record<string, string> = { glm: 'zai', kimi: 'moonshotai' };
    for (const [id, cfg] of Object.entries(legacy)) {
      const key = cfg?.apiKey?.trim();
      if (key) {
        await transport('pi_config_set_auth_key', { provider: alias[id] ?? id, apiKey: key });
      }
    }
    delete s.aiProviders;
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
    invalidatePiConfig();
  } catch {
    // best-effort migration
  }
};

/** streamFn for the Agent: injects the Rust-side fetch + explicit key. */
export const makeStreamFn = (
  models: MutableModels,
  keyResolver: (provider: string) => string | undefined,
) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (model: Model<any>, context: any, options: any) =>
    models.streamSimple(model, context, {
      ...options,
      fetch: piFetch as PiFetch,
      apiKey: keyResolver(model.provider),
    });
};
