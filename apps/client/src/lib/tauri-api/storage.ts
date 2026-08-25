import { transport } from '../transport';
import { isBrowserDemoMode } from '../browser-demo-files';
import type {
  BookmarkEntry,
  FileTag,
  FileNote,
  NoteSearchResult,
  FileAnnotation,
  CustomMetadataField,
  StorageAnalytics,
  DiagnosisResult,
  SqliteTableInfo,
  SqliteColumnInfo,
  SqliteQueryResult,
  ChatFileData,
  ChatFileSummary,
  ChatSession,
  ChatSessionSummary,
} from '../tauri-api-types';

// ── Bookmark operations ─────────────────────────────────────────────────────

export const getBookmarks = async (): Promise<BookmarkEntry[]> => await transport('get_bookmarks');

export const addBookmark = async (path: string, name: string): Promise<BookmarkEntry> =>
  await transport('add_bookmark', { path, name });

export const removeBookmark = async (path: string): Promise<void> =>
  await transport('remove_bookmark', { path });

export const updateBookmarkName = async (path: string, name: string): Promise<void> =>
  await transport('update_bookmark_name', { path, name });

// ── Storage Analytics ───────────────────────────────────────────────────────

export const analyzeStorage = async (path: string): Promise<StorageAnalytics> =>
  await transport('analyze_storage', { path });

// ── Directory Diagnostics ───────────────────────────────────────────────────

export const diagnoseDirectory = async (
  path: string,
  skipHidden = true,
  skipGitignored = true,
): Promise<DiagnosisResult> =>
  await transport('diagnose_directory', { path, skipHidden, skipGitignored });

// ── File Tags operations (Finder-tag metadata) ──────────────────────────────

// Browser demo: no backend, keep an in-memory tag store so the UI stays
// testable at ?demo=1.
const demoTags = new Map<string, FileTag[]>();
// Canonical English names — the same values Finder stores, localized
// for display by displayTagName().
const demoPalette: FileTag[] = [
  { name: 'Red', color: '#FF453A' },
  { name: 'Orange', color: '#FF9F0A' },
  { name: 'Yellow', color: '#FFD60A' },
  { name: 'Green', color: '#30D158' },
  { name: 'Blue', color: '#0A84FF' },
  { name: 'Purple', color: '#BF5AF2' },
  { name: 'Gray', color: '#98989D' },
];

export const getFileTags = async (path: string): Promise<FileTag[]> => {
  if (isBrowserDemoMode()) return demoTags.get(path) ?? [];
  return await transport('get_file_tags', { path });
};

export const setFileTags = async (path: string, tags: FileTag[]): Promise<void> => {
  if (isBrowserDemoMode()) {
    if (tags.length === 0) demoTags.delete(path);
    else demoTags.set(path, tags);
    return;
  }
  await transport('set_file_tags', { path, tags });
};

export const getAllFileTags = async (): Promise<FileTag[]> => {
  if (isBrowserDemoMode()) return demoPalette;
  return await transport('get_all_file_tags');
};

export const getFileTagsBatch = async (paths: string[]): Promise<Record<string, FileTag[]>> => {
  if (isBrowserDemoMode()) {
    const result: Record<string, FileTag[]> = {};
    for (const p of paths) {
      const tags = demoTags.get(p);
      if (tags && tags.length > 0) result[p] = tags;
    }
    return result;
  }
  return await transport('get_file_tags_batch', { paths });
};

export const findFilesByTag = async (
  tagName: string,
): Promise<import('../tauri-api-types').FileEntry[]> => {
  if (isBrowserDemoMode()) {
    // Demo: collect paths carrying the tag from the in-memory store.
    const { getDemoDirectory } = await import('../browser-demo-files');
    const paths: string[] = [];
    for (const [p, tags] of demoTags) {
      if (tags.some((t) => t.name === tagName)) paths.push(p);
    }
    const seen = new Set<string>();
    const entries: import('../tauri-api-types').FileEntry[] = [];
    for (const dir of [
      '/home/user',
      '/home/user/Documents',
      '/home/user/Downloads',
      '/home/user/Desktop',
      '/home/user/Pictures',
    ]) {
      for (const f of getDemoDirectory(dir) ?? []) {
        if (paths.includes(f.path) && !seen.has(f.path)) {
          seen.add(f.path);
          entries.push(f);
        }
      }
    }
    return entries;
  }
  return await transport('find_files_by_tag', { tagName });
};

export const removeAllTagsFromFile = async (path: string): Promise<void> =>
  await transport('remove_all_tags_from_file', { path });

export const removeTagGlobally = async (tagName: string): Promise<void> =>
  await transport('remove_tag_globally', { tagName });

// ── Batch tag operations ────────────────────────────────────────────────────

export const batchAddTags = async (paths: string[], tags: FileTag[]): Promise<void> =>
  await transport('batch_add_tags', { paths, tags });

export const batchRemoveTags = async (paths: string[], tagNames: string[]): Promise<void> =>
  await transport('batch_remove_tags', { paths, tagNames });

// ── File Notes operations ───────────────────────────────────────────────────

export const getFileNotes = async (path: string): Promise<FileNote[]> =>
  await transport('get_file_notes', { path });

export const addFileNote = async (
  path: string,
  title: string,
  content: string,
): Promise<FileNote> => await transport('add_file_note', { path, title, content });

export const updateFileNote = async (
  path: string,
  noteId: string,
  title: string,
  content: string,
): Promise<void> => await transport('update_file_note', { path, noteId, title, content });

export const deleteFileNote = async (path: string, noteId: string): Promise<void> =>
  await transport('delete_file_note', { path, noteId });

export const getAllNotes = async (): Promise<Record<string, FileNote[]>> =>
  await transport('get_all_notes');

export const searchNotes = async (query: string): Promise<NoteSearchResult[]> =>
  await transport('search_notes', { query });

// ── Batch notes operations ──────────────────────────────────────────────────

export const batchSetNotes = async (
  paths: string[],
  title: string,
  content: string,
  mode: 'replace' | 'append',
): Promise<void> => await transport('batch_set_notes', { paths, title, content, mode });

// ── File Annotations operations ─────────────────────────────────────────────

export const getFileAnnotations = async (path: string): Promise<FileAnnotation[]> =>
  await transport('get_file_annotations', { path });

export const addFileAnnotation = async (path: string, text: string): Promise<FileAnnotation> =>
  await transport('add_file_annotation', { path, text });

export const toggleAnnotationResolved = async (path: string, annotationId: string): Promise<void> =>
  await transport('toggle_annotation_resolved', { path, annotationId });

export const deleteFileAnnotation = async (path: string, annotationId: string): Promise<void> =>
  await transport('delete_file_annotation', { path, annotationId });

export const getAllAnnotations = async (): Promise<Record<string, FileAnnotation[]>> =>
  await transport('get_all_annotations');

// ── Tag Categories operations ───────────────────────────────────────────────

// ── Custom Metadata operations ──────────────────────────────────────────────

export const getFileMetadata = async (path: string): Promise<CustomMetadataField[]> =>
  await transport('get_file_metadata', { path });

export const setFileMetadata = async (path: string, fields: CustomMetadataField[]): Promise<void> =>
  await transport('set_file_metadata', { path, fields });

export const getAllMetadataKeys = async (): Promise<string[]> =>
  await transport('get_all_metadata_keys');

// ── Chat history operations ─────────────────────────────────────────────────

export const getChatSessions = async (): Promise<ChatSessionSummary[]> =>
  await transport('get_chat_sessions');

export const getChatSession = async (sessionId: string): Promise<ChatSession | null> =>
  await transport('get_chat_session', { sessionId });

export const saveChatSession = async (session: ChatSession): Promise<void> =>
  await transport('save_chat_session', { session });

export const deleteChatSession = async (sessionId: string): Promise<void> =>
  await transport('delete_chat_session', { sessionId });

export const clearChatHistory = async (): Promise<void> => await transport('clear_chat_history');

// ── Chat-as-Files operations ────────────────────────────────────────────────

export const getChatsDirectory = async (): Promise<string> =>
  await transport('get_chats_directory');

export const createChatFile = async (directory: string, title?: string): Promise<string> =>
  await transport('create_chat_file', { directory, title: title || null });

export const readChatFile = async (path: string): Promise<ChatFileData> =>
  await transport('read_chat_file', { path });

export const saveChatFile = async (path: string, data: ChatFileData): Promise<void> =>
  await transport('save_chat_file', { path, data });

export const getChatFileSummary = async (path: string): Promise<ChatFileSummary> =>
  await transport('get_chat_file_summary', { path });

// ── SQLite database operations ──────────────────────────────────────────────

export const listSqliteTables = async (path: string): Promise<SqliteTableInfo[]> =>
  await transport('list_sqlite_tables', { path });

export const getSqliteTableColumns = async (
  path: string,
  table: string,
): Promise<SqliteColumnInfo[]> => await transport('get_sqlite_table_columns', { path, table });

export const querySqliteTable = async (
  path: string,
  table: string,
  limit: number,
  offset: number,
): Promise<SqliteQueryResult> =>
  await transport('query_sqlite_table', { path, table, limit, offset });

export const executeSqliteQuery = async (path: string, query: string): Promise<SqliteQueryResult> =>
  await transport('execute_sqlite_query', { path, query });
