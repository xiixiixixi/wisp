import { transport } from '../transport';
import { STORAGE_KEYS } from '../storage-keys';
import type { SafeAgentSettings } from '../tauri-api-types';

// ── AI model operations ─────────────────────────────────────────────────────

export const getAiModels = async (): Promise<
  {
    id: string;
    name: string;
    provider: string;
    available: boolean;
  }[]
> => await transport('get_ai_models');

export const checkOllamaStatus = async (): Promise<boolean> =>
  await transport('check_ollama_status');

// ── AI chat / analysis ──────────────────────────────────────────────────────

/**
 * Models routed to a user-configured endpoint carry the "custom-openai:" or
 * "custom-anthropic:" prefix. The endpoint + key are injected here from
 * settings so every caller (chat, extensions) works unchanged.
 */
const CUSTOM_OPENAI_PREFIX = 'custom-openai:';
const CUSTOM_ANTHROPIC_PREFIX = 'custom-anthropic:';

const readCustomEndpointConfig = (): { endpoint: string; apiKey: string } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return null;
    const s = JSON.parse(raw) as Record<string, unknown>;
    const endpoint = typeof s.aiCustomEndpoint === 'string' ? s.aiCustomEndpoint : '';
    const apiKey = typeof s.aiCustomApiKey === 'string' ? s.aiCustomApiKey : '';
    if (!endpoint || !apiKey) return null;
    return { endpoint, apiKey };
  } catch {
    return null;
  }
};

export const chatWithAI = async (
  model: string,
  messages: { role: string; content: string }[],
  fileContext?: {
    name: string;
    path: string;
    file_type: string;
    content?: string;
    image_base64?: string;
    image_mime_type?: string;
  } | null,
): Promise<string> => {
  const usesCustom =
    model.startsWith(CUSTOM_OPENAI_PREFIX) || model.startsWith(CUSTOM_ANTHROPIC_PREFIX);
  const custom = usesCustom ? readCustomEndpointConfig() : null;
  return await transport('chat_with_ai', {
    model,
    messages,
    fileContext: fileContext || null,
    customEndpoint: custom?.endpoint ?? null,
    customApiKey: custom?.apiKey ?? null,
  });
};

// ── Approval-gated file write (extension sandbox `files.write`) ─────────────

export const agentWriteFileWithPermission = async (
  filePath: string,
  content: string,
  permissionGranted: boolean,
): Promise<void> =>
  await transport('agent_write_file_with_permission', {
    filePath,
    content,
    permissionGranted,
  });

// ── Legacy agent settings (read-only; default model for extension ai.chat) ──

export const getAgentSettings = async (): Promise<SafeAgentSettings> =>
  await transport('get_agent_settings');

// ── mem0 cloud memory ───────────────────────────────────────────────────────

export interface Mem0ConfigState {
  enabled: boolean;
  has_key: boolean;
  user_id: string;
  auto_capture: boolean;
}

export interface Mem0HitDto {
  id: string;
  memory: string;
  score: number | null;
  categories: string[];
}

export const mem0ConfigState = async (): Promise<Mem0ConfigState> =>
  await transport('mem0_config_state');

export const mem0SaveConfig = async (opts: {
  enabled?: boolean;
  userId?: string;
  autoCapture?: boolean;
  apiKey?: string;
}): Promise<Mem0ConfigState> =>
  await transport('mem0_save_config', {
    enabled: opts.enabled ?? null,
    userId: opts.userId ?? null,
    autoCapture: opts.autoCapture ?? null,
    apiKey: opts.apiKey ?? null,
  });

export const mem0List = async (limit = 50): Promise<Mem0HitDto[]> =>
  await transport('mem0_list', { limit });

export const mem0Delete = async (id: string): Promise<void> =>
  await transport('mem0_delete', { id });

export const mem0DeleteAll = async (): Promise<void> =>
  await transport('mem0_delete_all');

