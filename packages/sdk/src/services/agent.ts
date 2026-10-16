import { transport } from '../transport';
import type {
  SafeAgentSettings,
  AgentPermissions,
  MemoryEntry,
} from '../types';

// The conversational agent engine is pi (@earendil-works/pi-ai + pi-agent-core)
// running in the WebView; the SDK only exposes its Rust-side support commands.
// The legacy `agent_chat` session loop was removed — do not reintroduce it here.

export const agentWriteFileWithPermission = async (
  filePath: string,
  content: string,
  permissionGranted: boolean,
): Promise<void> => {
  return await transport('agent_write_file_with_permission', {
    filePath,
    content,
    permissionGranted,
  });
};

export const getAgentSettings = async (): Promise<SafeAgentSettings> => {
  return await transport('get_agent_settings');
};

export const getAgentMemory = async (): Promise<MemoryEntry[]> => {
  return await transport('get_agent_memory');
};

export const clearAgentMemory = async (): Promise<void> => {
  return await transport('clear_agent_memory');
};

export const deleteAgentMemory = async (key: string): Promise<void> => {
  return await transport('delete_agent_memory', { key });
};

export const getAgentPermissions = async (): Promise<AgentPermissions> => {
  return await transport('get_agent_permissions');
};

export const updateAgentPermissions = async (permissions: AgentPermissions): Promise<void> => {
  return await transport('update_agent_permissions', { permissions });
};
