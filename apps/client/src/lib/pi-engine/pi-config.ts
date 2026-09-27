/**
 * pi-format model configuration client.
 *
 * Mirrors pi's own files: ~/.pi/agent/models.json (provider + model
 * declarations) and ~/.pi/agent/auth.json (credentials, edited via the
 * backend so keys never linger in the DOM longer than a request).
 */
import { transport } from '@/lib/transport';

/** Marker the backend substitutes for literal apiKey values on read. */
export const API_KEY_KEEP_MARKER = '$WISP_KEEP_KEY$';

export interface PiModelDef {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  /** Wisp extension: model's default thinking level (low/medium/high). */
  thinkingLevel?: 'low' | 'medium' | 'high';
  input?: ('text' | 'image')[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
}

export interface PiProviderConfig {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  models?: PiModelDef[];
  modelOverrides?: Record<string, Record<string, unknown>>;
}

export interface ModelsJson {
  providers: Record<string, PiProviderConfig>;
}

export interface AuthProviderStatus {
  provider: string;
  has_key: boolean;
}

export interface PiConfigStateDto {
  models_path: string;
  auth_path: string;
  models_json: ModelsJson;
  auth_status: AuthProviderStatus[];
}

export const emptyModelsJson = (): ModelsJson => ({ providers: {} });

export const piConfigState = (): Promise<PiConfigStateDto> =>
  transport<PiConfigStateDto>('pi_config_state');

export const piConfigWriteModels = (models: ModelsJson): Promise<void> =>
  transport('pi_config_write_models', { modelsJson: models });

export const piConfigSetAuthKey = (provider: string, apiKey: string): Promise<void> =>
  transport('pi_config_set_auth_key', { provider, apiKey });

export const piConfigRemoveAuthKey = (provider: string): Promise<void> =>
  transport('pi_config_remove_auth_key', { provider });

/** provider → api key, resolved pi-style (auth.json first, env second). */
export const piAuthKeys = (): Promise<Record<string, string>> =>
  transport<Record<string, string>>('pi_auth_keys');
