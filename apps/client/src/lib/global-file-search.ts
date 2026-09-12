import { TauriAPI, type SearchResult } from './tauri-api';
import { getDemoSearchFiles, isBrowserDemoMode } from './browser-demo-files';

export const GLOBAL_SEARCH_LIMIT = 50;
// The native find_files command also returns at most 1,000 candidates per root.
export const GLOBAL_SEARCH_CANDIDATE_LIMIT = 1_000;
const CLASSIFICATION_CONCURRENCY = 8;
export type GlobalSearchKind = 'all' | 'files' | 'folders';
export type GlobalFileResult = SearchResult & { isDir: boolean };
export interface GlobalSearchUpdate {
  results: GlobalFileResult[];
  partial: boolean;
  limited: boolean;
}
export interface GlobalSearchOptions {
  kind?: GlobalSearchKind;
  signal?: AbortSignal;
}

export const matchesSearchKind = (isDir: boolean, kind: GlobalSearchKind): boolean =>
  kind === 'all' || (kind === 'folders' ? isDir : !isDir);

const searchSystem = async (
  query: string,
  { kind = 'all', signal }: GlobalSearchOptions,
): Promise<GlobalSearchUpdate> => {
  const drives = await TauriAPI.listDrives();
  if (signal?.aborted) return { results: [], partial: false, limited: false };
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
  if (searches.every((result) => result.status === 'rejected')) {
    throw new Error('System search unavailable');
  }
  const sources = searches.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  // Interleave volumes so a large first volume cannot consume the whole budget.
  const paths = new Set<string>();
  const longestSource = Math.max(0, ...sources.map((source) => source.length));
  for (
    let index = 0;
    index < longestSource && paths.size < GLOBAL_SEARCH_CANDIDATE_LIMIT;
    index++
  ) {
    for (const source of sources) {
      if (source[index]) paths.add(source[index]);
      if (paths.size >= GLOBAL_SEARCH_CANDIDATE_LIMIT) break;
    }
  }
  const candidates = [...paths];
  const results: GlobalFileResult[] = [];
  let scanned = 0;
  while (scanned < candidates.length && results.length < GLOBAL_SEARCH_LIMIT && !signal?.aborted) {
    const batchSize = Math.min(CLASSIFICATION_CONCURRENCY, GLOBAL_SEARCH_LIMIT - results.length);
    const batch = candidates.slice(scanned, scanned + batchSize);
    const classified = await Promise.all(
      batch.map(async (path): Promise<GlobalFileResult | null> => {
        try {
          const isDir = await TauriAPI.isDir(path);
          if (!matchesSearchKind(isDir, kind)) return null;
          return {
            path,
            filename: path.split(/[/\\]/).pop() || path,
            matches: [],
            score: 1,
            relevance_type: 'filesystem',
            isDir,
          };
        } catch {
          return null; // Stale and inaccessible paths are not actionable results.
        }
      }),
    );
    results.push(...classified.filter((result): result is GlobalFileResult => result !== null));
    scanned += batch.length;
  }
  return {
    results,
    partial: searches.some((result) => result.status === 'rejected'),
    limited:
      scanned < candidates.length ||
      candidates.length >= GLOBAL_SEARCH_CANDIDATE_LIMIT ||
      sources.some((source) => source.length >= GLOBAL_SEARCH_CANDIDATE_LIMIT),
  };
};

/** Search names through the OS provider, filtering type before the display limit. */
export const searchGlobalFiles = async (
  query: string,
  onUpdate: (update: GlobalSearchUpdate) => void,
  options: GlobalSearchOptions = {},
): Promise<void> => {
  const { kind = 'all', signal } = options;
  if (signal?.aborted) return;
  if (isBrowserDemoMode()) {
    const files = getDemoSearchFiles(query).filter((file) => matchesSearchKind(file.is_dir, kind));
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
      limited: files.length > GLOBAL_SEARCH_LIMIT,
    });
    return;
  }
  const update = await searchSystem(query, options);
  if (!signal?.aborted) onUpdate(update);
};
