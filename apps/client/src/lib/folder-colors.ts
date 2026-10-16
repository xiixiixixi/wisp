/**
 * Folder Color Coding — Finder-tag backed.
 *
 * A folder's colour is stored as a real Finder tag (extended attribute),
 * so Finder, Spotlight and other file managers see the same colour. A
 * localStorage cache keeps the synchronous reads the UI needs; writes go
 * to both. Mutations dispatch a `folder-colors-changed` CustomEvent on
 * window so listeners can re-render.
 */

import { TauriAPI, type FileTag } from '@/lib/tauri-api';
import { FINDER_TAG_COLORS } from '@/lib/finder-tags';
import { notifyFileTagsChanged } from '@/lib/file-tags-cache';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import i18n from '@/i18n';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FolderColor {
  path: string;
  colorId: string;
  label?: string;
}

export interface FolderColorDef {
  id: string;
  hex: string;
  label: string;
}

// ── Palette: Finder's seven standard colours ────────────────────────────────

export const FOLDER_COLORS: FolderColorDef[] = FINDER_TAG_COLORS.map((c) => ({
  id: c.id,
  hex: c.hex,
  label: c.id, // resolved through i18n at display time (colorName)
}));

const COLOR_HEX_MAP = new Map<string, string>(FOLDER_COLORS.map((c) => [c.id, c.hex]));

/** Localised colour name for display (红色, 橙色, …). */
export const colorName = (colorId: string): string => i18n.t(`dialogs.colors.${colorId}`);

/**
 * Canonical on-disk tag name for a colour id — macOS stores the standard
 * tags as English (Red, Orange, …); using the same names keeps Wisp's
 * colour tags identical to Finder's instead of spawning duplicates.
 */
export const canonicalTagName = (colorId: string): string => {
  const id = colorId === 'grey' ? 'gray' : colorId;
  return id.charAt(0).toUpperCase() + id.slice(1);
};

const paletteColorNames = (): Set<string> =>
  new Set(FOLDER_COLORS.map((c) => canonicalTagName(c.id)));

// ── Storage key (cache only; the truth lives in Finder tags) ───────────────

const STORAGE_KEY = STORAGE_KEYS.FOLDER_COLORS;
const MIGRATION_KEY = 'wisp:folder-colors-migrated-to-finder-tags';

// ── Internal helpers ─────────────────────────────────────────────────────────

const readAll = (): FolderColor[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FolderColor[];
  } catch {
    return [];
  }
};

const writeAll = (entries: FolderColor[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent('folder-colors-changed'));
};

/**
 * Write the colour as a Finder tag: colour-role tags (tags whose name is a
 * palette colour name) are replaced, custom-named tags are preserved.
 */
const writeFinderTag = async (path: string, colorId: string | null): Promise<void> => {
  try {
    const current = await TauriAPI.getFileTags(path).catch(() => [] as FileTag[]);
    const names = paletteColorNames();
    const kept = current.filter((t) => !names.has(t.name));
    const next =
      colorId != null
        ? [...kept, { name: canonicalTagName(colorId), color: COLOR_HEX_MAP.get(colorId) ?? '' }]
        : kept;
    await TauriAPI.setFileTags(path, next);
    notifyFileTagsChanged();
  } catch (err) {
    console.error('Failed to write folder colour as Finder tag:', err);
  }
};

// ── Public API ───────────────────────────────────────────────────────────────

/** Get the color entry for a specific folder path, or null if none. */
export const getFolderColor = (path: string): FolderColor | null => {
  const all = readAll();
  return all.find((e) => e.path === path) ?? null;
};

/** Set or update the color for a folder path (also writes the Finder tag). */
export const setFolderColor = (path: string, colorId: string, _label?: string): void => {
  const all = readAll();
  const idx = all.findIndex((e) => e.path === path);
  const entry: FolderColor = { path, colorId };
  if (idx >= 0) {
    all[idx] = entry;
  } else {
    all.push(entry);
  }
  writeAll(all);
  writeFinderTag(path, colorId);
};

/** Remove the color assignment for a folder path (also updates the Finder tag). */
export const removeFolderColor = (path: string): void => {
  const all = readAll();
  const filtered = all.filter((e) => e.path !== path);
  if (filtered.length !== all.length) {
    writeAll(filtered);
    writeFinderTag(path, null);
  }
};

/** Get all folder color assignments. */
export const getAllFolderColors = (): FolderColor[] => {
  return readAll();
};

/** Quick hex lookup: returns the hex color string for a folder, or null. */
export const getFolderColorHex = (path: string): string | null => {
  const entry = getFolderColor(path);
  if (!entry) return null;
  return COLOR_HEX_MAP.get(entry.colorId) ?? null;
};

/** Get the hex value for a color ID. */
export const getColorHex = (colorId: string): string | null => {
  return COLOR_HEX_MAP.get(colorId) ?? null;
};

/**
 * Refresh the cache from a batch of Finder tags (called after the file
 * list loads). A folder's colour is the first palette-coloured tag.
 */
export const syncFolderColorsFromTags = (tagsByPath: Record<string, FileTag[]>): void => {
  const names = paletteColorNames();
  const existing = new Map(readAll().map((e) => [e.path, e]));
  for (const [path, tags] of Object.entries(tagsByPath)) {
    const colourTag = tags.find((t) => names.has(t.name));
    if (!colourTag) continue;
    const def = FOLDER_COLORS.find((c) => c.hex.toLowerCase() === colourTag.color.toLowerCase());
    if (def) existing.set(path, { path, colorId: def.id });
  }
  writeAll(Array.from(existing.values()));
};

/**
 * One-time migration: convert pre-Finder-tag localStorage colours into
 * real Finder tags. Old palette ids map onto Finder's seven colours
 * (pink folds into purple).
 */
export const migrateFolderColorsToFinderTags = (): void => {
  if (localStorage.getItem(MIGRATION_KEY)) return;
  localStorage.setItem(MIGRATION_KEY, '1');
  const entries = readAll();
  if (entries.length === 0) return;
  const idMap = (id: string) => (id === 'pink' ? 'purple' : id);
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    const mapped = idMap(e.colorId);
    if (!COLOR_HEX_MAP.has(mapped)) continue;
    groups.set(mapped, [...(groups.get(mapped) ?? []), e.path]);
  }
  for (const [colorId, paths] of groups) {
    const name = canonicalTagName(colorId);
    TauriAPI.batchAddTags(paths, [{ name, color: COLOR_HEX_MAP.get(colorId) ?? '' }]).catch((err) =>
      console.error('Folder colour migration failed:', err),
    );
  }
};
