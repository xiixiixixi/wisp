import type { GlobalSearchKind } from '@/lib/global-file-search';
import { getKindBucketByName, type KindGroup } from '@/lib/kind-groups';

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

// ── Search kind chips (#29) ──────────────────────────────────────────────────
// Finder's 「种类」 filter row: the three coarse kinds stay server-side, the
// finer kinds reuse the F2 kind-bucket table for client-side filtering.

export type SearchKindChip = GlobalSearchKind | 'images' | 'videos' | 'audio' | 'documents' | 'archives';

/** Chip order mirrors Finder's 种类 menu: 全部/文件/文件夹 then media kinds. */
export const SEARCH_KIND_CHIPS: SearchKindChip[] = [
  'all',
  'files',
  'folders',
  'images',
  'videos',
  'audio',
  'documents',
  'archives',
];

/** F2 buckets each chip accepts — PDF rides with 文稿, Finder-style. */
const CHIP_KIND_GROUPS: Record<Exclude<SearchKindChip, GlobalSearchKind>, KindGroup[]> = {
  images: ['images'],
  videos: ['movies'],
  audio: ['audio'],
  documents: ['documents', 'pdf'],
  archives: ['archives'],
};

/** The backend mfind only understands all/files/folders; finer chips filter
 *  client-side against `files` results. */
export const backendKindForChip = (chip: SearchKindChip): GlobalSearchKind =>
  chip === 'all' || chip === 'files' || chip === 'folders' ? chip : 'files';

/** Bucket check on a bare name — works for folder listings, global results
 *  (extension-approximated) and recent files alike. */
export const matchesKindChip = (isDir: boolean, name: string, chip: SearchKindChip): boolean => {
  if (chip === 'all') return true;
  if (chip === 'files') return !isDir;
  if (chip === 'folders') return isDir;
  if (isDir) return false;
  return CHIP_KIND_GROUPS[chip].includes(getKindBucketByName(isDir, name));
};

