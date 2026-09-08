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

/** Publish either source as soon as it arrives, then merge by full path. */
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
  const indexedSearch = async (): Promise<GlobalSearchUpdate> => {
    let results: SearchResult[];
    try {
      results = (await TauriAPI.enhancedSearch(query, undefined, GLOBAL_SEARCH_LIMIT)).results;
    } catch {
      results = await TauriAPI.searchTokens(query, GLOBAL_SEARCH_LIMIT);
    }
    return {
      results: results.map((result) => ({ ...result, isDir: false })),
      partial: false,
      limited: results.length >= GLOBAL_SEARCH_LIMIT,
    };
  };
  const sources: GlobalFileResult[][] = [[], []];
  let partial = false;
  let limited = false;
  const publish = () => {
    const merged = new Map<string, GlobalFileResult>();
    // Filename results take priority and retain the explicit folder flag.
    for (const result of sources.flat()) {
      if (!merged.has(result.path)) merged.set(result.path, result);
    }
    onUpdate({
      results: [...merged.values()].slice(0, GLOBAL_SEARCH_LIMIT),
      partial,
      limited: limited || merged.size >= GLOBAL_SEARCH_LIMIT,
    });
  };
  await Promise.all(
    [searchSystem(query), indexedSearch()].map(async (source, index) => {
      try {
        const update = await source;
        sources[index] = update.results;
        partial ||= update.partial;
        limited ||= update.limited;
      } catch {
        partial = true;
      }
      publish();
    }),
  );
};
