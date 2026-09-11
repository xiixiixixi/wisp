import { TauriAPI, type SearchResult } from './tauri-api';
import { getDemoSearchFiles, isBrowserDemoMode } from './browser-demo-files';

export const GLOBAL_SEARCH_LIMIT = 50;
export type GlobalFileResult = SearchResult & { isDir: boolean };
export interface GlobalSearchUpdate {
  results: GlobalFileResult[];
  partial: boolean;
  limited: boolean;
}

// Volume roots, never the active pane. On macOS '/' delegates to Spotlight
// across indexed volumes. Nested mount points need not be searched twice.
const searchSystem = async (query: string): Promise<GlobalSearchUpdate> => {
  const drives = await TauriAPI.listDrives();
  const roots = [...new Set(drives.map((drive) => drive.path))].filter(
    (path, _, paths) =>
      !paths.some(
        (other) =>
          other !== path &&
          path.startsWith(other.endsWith('/') || other.endsWith('\\') ? other : `${other}/`),
      ),
  );
  if (!roots.length) throw new Error('No searchable volumes');
  const searches = await Promise.allSettled(roots.map((root) => TauriAPI.findFiles(query, root)));
  const paths = [
    ...new Set(searches.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))),
  ];
  if (searches.every((result) => result.status === 'rejected')) {
    throw new Error('System search unavailable');
  }
  const classified = await Promise.all(
    paths.slice(0, GLOBAL_SEARCH_LIMIT).map(async (path) => {
      try {
        return {
          path,
          filename: path.split(/[/\\]/).pop() || path,
          matches: [],
          score: 1,
          relevance_type: 'filesystem',
          isDir: await TauriAPI.isDir(path),
        };
      } catch {
        return null; // A stale or inaccessible path is not a usable result.
      }
    }),
  );
  return {
    results: classified.filter((result): result is NonNullable<typeof result> => result !== null),
    partial: searches.some((result) => result.status === 'rejected'),
    limited: paths.length >= GLOBAL_SEARCH_LIMIT,
  };
};

/**
 * File search is delegated entirely to the operating system: Wisp keeps no
 * index of its own, so every query goes to the platform provider (Spotlight on
 * macOS) and reflects the filesystem as it is right now.
 */
export const searchGlobalFiles = async (
  query: string,
  onUpdate: (update: GlobalSearchUpdate) => void,
): Promise<void> => {
  if (isBrowserDemoMode()) {
    const files = getDemoSearchFiles(query);
    onUpdate({
      results: files.slice(0, GLOBAL_SEARCH_LIMIT).map((file) => ({
        path: file.path,
        filename: file.name,
        isDir: file.is_dir,
        matches: [],
        score: 1,
        relevance_type: 'demo',
      })),
      partial: false,
      limited: files.length >= GLOBAL_SEARCH_LIMIT,
    });
    return;
  }
  const update = await searchSystem(query);
  onUpdate(update);
};
