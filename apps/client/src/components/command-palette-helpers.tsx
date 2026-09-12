import type { GlobalSearchKind } from '@/lib/global-file-search';

export type SearchSelectionIntent = 'open' | 'reveal';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect?: (
    filePath: string,
    isDir: boolean | undefined,
    intent?: SearchSelectionIntent,
  ) => void;
  currentPath?: string;
}

export interface PaletteEntry {
  path: string;
  name: string;
  isDir?: boolean;
  source: 'recent' | 'search' | 'path' | 'web';
}

export const FILE_ROW_HEIGHT = 58;
export const RECENT_DISPLAY_LIMIT = 12;
export const RECENT_CANDIDATE_LIMIT = 200;

export const isPathQuery = (query: string): boolean =>
  query.startsWith('/') ||
  query.startsWith('~') ||
  /^[A-Za-z]:[/\\]/.test(query) ||
  query.startsWith('\\\\') ||
  query.startsWith('wisp://');

export const SEARCH_KINDS: GlobalSearchKind[] = ['all', 'files', 'folders'];
