import { transport } from '../transport';

export const getAiModels = async (): Promise<
  { id: string; name: string; provider: string; available: boolean }[]
> => {
  return await transport('get_ai_models');
};

export const checkOllamaStatus = async (): Promise<boolean> => {
  return await transport('check_ollama_status');
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
  return await transport('chat_with_ai', {
    model,
    messages,
    fileContext: fileContext || null,
  });
};

export const analyzeFileWithAI = async (
  model: string,
  fileContext: { name: string; path: string; file_type: string; content?: string },
): Promise<string> => {
  return await transport('analyze_file_with_ai', {
    model,
    fileContext,
  });
};

export const getFileHelp = async (
  model: string,
  fileName: string,
  fileType: string,
): Promise<string> => {
  return await transport('get_file_help', {
    model,
    fileName,
    fileType,
  });
};

export const suggestFilename = async (filePath: string): Promise<string[]> => {
  return await transport('suggest_filename', { filePath });
};

export const autoTagFiles = async (filePaths: string[]): Promise<[string, string[]][]> => {
  return await transport('auto_tag_files', { filePaths });
};
