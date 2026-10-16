import { TauriAPI } from '@/lib/tauri-api';

export interface BookmarkDropResult {
  added: number;
  existing: number;
  failed: number;
}

/** Save references only; a sidebar favorite must never transfer the source file. */
export async function addDroppedBookmarks(paths: string[]): Promise<BookmarkDropResult> {
  const uniquePaths = [...new Set(paths)];
  const result: BookmarkDropResult = { added: 0, existing: 0, failed: 0 };
  let savedPaths: Set<string>;
  try {
    savedPaths = new Set((await TauriAPI.getBookmarks()).map((item) => item.path));
  } catch {
    return { ...result, failed: uniquePaths.length };
  }
  for (const path of uniquePaths) {
    if (savedPaths.has(path)) {
      result.existing += 1;
      continue;
    }
    try {
      const name =
        path
          .replace(/[/\\]+$/, '')
          .split(/[/\\]/)
          .pop() || path;
      await TauriAPI.addBookmark(path, name);
      result.added += 1;
      savedPaths.add(path);
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
