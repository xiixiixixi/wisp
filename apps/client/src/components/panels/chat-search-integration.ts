/**
 * System-prompt context describing how the chat agent should search.
 *
 * Wisp keeps no index of its own: filename search is delegated to the
 * operating system (Spotlight on macOS), and content search scans files on
 * demand. The prompt below reflects that.
 */
export const AI_SEARCH_PROMPT = `
## Search Capabilities
You can search for files and content using two strategies:

- **Filename matching** — the OS search provider (Spotlight on macOS) answers name queries
  instantly. Reach it through search_files with a descriptive name query.
- **Content search (grep)** — searches inside file contents on demand. Use it when the user
  asks where something is written rather than what a file is called.

When the user asks to find or search for something, pick the strategy that matches the intent:
name queries for "where is the file called X", content queries for "which files mention X".
Always prefer a path the user is already working in, and say which directory a search covered.

You can combine search with file operations — for example, "find all TODO comments and list
the files" or "find duplicate configs across the project".
`.trim();
