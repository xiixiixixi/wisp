import { transport } from '../transport';
import type { GrepSearchMatch } from '../tauri-api-types';

// ── Basic search ────────────────────────────────────────────────────────────
//
// All file search goes through the operating system: `find_files` delegates to
// Spotlight (mdfind) on macOS, and `search_in_files` / `grep_search` scan files
// on demand. Wisp keeps no index of its own.

export const findFiles = async (pattern: string, searchPath: string): Promise<string[]> =>
  await transport('find_files', { pattern, searchPath });

export const searchInFiles = async (
  pattern: string,
  searchPath: string,
): Promise<
  {
    file: string;
    line: number;
    content: string;
  }[]
> => await transport('search_in_files', { pattern, searchPath });

export const grepSearch = async (
  query: string,
  searchPath: string,
  maxResults?: number,
): Promise<GrepSearchMatch[]> =>
  await transport('grep_search', { query, searchPath, maxResults: maxResults ?? null });
