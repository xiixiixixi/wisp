/**
 * Module-level cache of per-file Finder tags.
 *
 * The context menu is built synchronously, but tags now live in the
 * file's extended attributes (async reads). FileGrid's batch loader keeps
 * this cache fresh; the menu reads it synchronously. Mutations update
 * the cache optimistically and dispatch `file-tags-changed` so views
 * re-fetch.
 */
import { TauriAPI, type FileTag } from '@/lib/tauri-api';
import { FINDER_TAG_COLORS } from '@/lib/finder-tags';
import i18n from '@/i18n';

const cache = new Map<string, FileTag[]>();

// ── Tag palette (Finder's own list) ─────────────────────────────────────────
let tagPalette: FileTag[] | null = null;

const defaultPalette = (): FileTag[] =>
  FINDER_TAG_COLORS.map((c) => ({
    name: i18n.t(`dialogs.colors.${c.id}`),
    color: c.hex,
  }));

export const getTagPalette = (): FileTag[] => tagPalette ?? defaultPalette();

/** Load Finder's palette once (call at startup or before first menu use). */
export const ensureTagPalette = (): void => {
  if (tagPalette) return;
  TauriAPI.getAllFileTags()
    .then((tags) => {
      if (tags.length > 0) tagPalette = tags;
    })
    .catch(() => {
      /* demo / backend unavailable — the default palette stays */
    });
};

export const getCachedFileTags = (path: string): FileTag[] => cache.get(path) ?? [];

export const setCachedFileTags = (path: string, tags: FileTag[]): void => {
  if (tags.length === 0) cache.delete(path);
  else cache.set(path, tags);
};

export const primeFileTagsCache = (entries: Record<string, FileTag[]>): void => {
  for (const [path, tags] of Object.entries(entries)) {
    setCachedFileTags(path, tags);
  }
};

export const notifyFileTagsChanged = (): void => {
  window.dispatchEvent(new CustomEvent('file-tags-changed'));
};

/** Toggle one tag on a file (Finder semantics: click toggles membership). */
export const toggleTagOnFile = async (
  path: string,
  tag: FileTag,
  apply: (path: string, tags: FileTag[]) => Promise<unknown>,
  read?: (path: string) => Promise<FileTag[]>,
): Promise<void> => {
  const current = read ? await read(path).catch(() => []) : getCachedFileTags(path);
  const next = current.some((t) => t.name === tag.name)
    ? current.filter((t) => t.name !== tag.name)
    : [...current, tag];
  setCachedFileTags(path, next);
  try {
    await apply(path, next);
    // Notify only after the write lands so listeners re-read fresh data.
    notifyFileTagsChanged();
  } catch (err) {
    console.error('Failed to write Finder tags:', err);
    setCachedFileTags(path, current);
    notifyFileTagsChanged();
  }
};
