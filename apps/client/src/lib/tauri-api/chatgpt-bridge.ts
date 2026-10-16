import { transport, listenToEvent as transportListen } from '../transport';
import type {
  ChatgptBridgeConfig,
  ChatgptBridgeState,
  ChatgptBridgeStatus,
} from '../tauri-api-types';

// ── ChatGPT Bridge (OpenAI Secure MCP Tunnel) ───────────────────────────────

export const chatgptBridgeGetState = async (): Promise<ChatgptBridgeState> =>
  await transport('chatgpt_bridge_get_state');

export const chatgptBridgeGetStatus = async (): Promise<ChatgptBridgeStatus> =>
  await transport('chatgpt_bridge_get_status');

export const chatgptBridgeSaveConfig = async (
  config: ChatgptBridgeConfig,
): Promise<ChatgptBridgeState> => await transport('chatgpt_bridge_save_config', { config });

export const chatgptBridgeSetApiKey = async (apiKey: string): Promise<void> =>
  await transport('chatgpt_bridge_set_api_key', { apiKey });

export const chatgptBridgeDeleteApiKey = async (): Promise<void> =>
  await transport('chatgpt_bridge_delete_api_key');

export const chatgptBridgeRestart = async (): Promise<ChatgptBridgeStatus> =>
  await transport('chatgpt_bridge_restart');

export const chatgptBridgeStop = async (): Promise<ChatgptBridgeStatus> =>
  await transport('chatgpt_bridge_stop');

export const listenToChatgptBridgeStatus = async (
  callback: (status: ChatgptBridgeStatus) => void,
): Promise<() => void> => transportListen<ChatgptBridgeStatus>('chatgpt-bridge-status', callback);
