# Global search, path control, and icon loading — 2026-09-08

Scope: latest three browser comments only. No settings simplification, version bump, commit, push, or release.

## Changes

- Global search starts system-volume filename search and Wisp indexed search concurrently. macOS volume root `/` uses the existing bounded Spotlight command. Indexed matches no longer suppress system lookup; the active pane never constrains scope. Full-path deduplication preserves same-name files and explicit folder classification. Sources publish progressively with stale-query guards and path-stable keyboard selection.
- Full paths (including filename) wrap without ellipsis in recent and search results. Virtual rows measure actual height. One-character Chinese queries work. Source failures and the 50-result display limit are disclosed.
- Removed the breadcrumb pencil. Background click, the existing keyboard shortcut, and overflow-menu full-path editing remain available.
- Native icons immediately show the existing semantic fallback, which remains until the image loads. Native-generation/decode failures no longer leave a blank. Settled cache entries retain their URL for synchronous reuse; request deduplication and viewport queue cancellation remain intact.
- Browser demo explicitly labels its scope and includes three same-name Markdown files in Documents, Research, and Downloads with working destination content.

## Verification

- Before fix: the added pending-native-icon test failed on the `opacity-0` wrapper. After fix: 56 tests pass across CommandPalette, FinderFileIcon, NavigationBar, global-file-search, and breadcrumb-layout (5 suites). Includes progressive selection stability, unavailable sources, duplicate paths, volume coverage, warm-cache single-call behavior, decode failure, and queue cancellation.
- Targeted ESLint: no errors or warnings. `pnpm exec tsc --noEmit`: pass. `pnpm frontend:build`: pass (17.04s; existing bundle-size/dynamic-import warnings remain). Build log: `/tmp/wisp-global-search-build.log`. `git diff --check`: pass.
- Current browser at 942×865: all three same-name demo results show their complete paths. Selecting Downloads navigated the active pane to `/home/user/Downloads`, showing the 4 KB copy with `aria-selected=true`. Returned to Documents without changing the split layout.
- 390×844: result rows measured 55, 73, and 55 px. No overlap or horizontal overflow; computed listbox scrollbar width `none`. Temporary viewport override reset.
- Captures: `review/global-search-desktop.png`, `review/global-search-mobile.png`.
- Read-only macOS Spotlight smoke check using the same `-onlyin / -name` arguments returned the actual workspace FinderFileIcon.tsx in 310 ms (one match). This is a single command smoke check, not an app performance benchmark.

## Limits

- Native Tauri UI/real icon timing was not measured end-to-end; deterministic tests cover delayed IPC and image loading. Browser demo icons are inline SVGs, not native icon requests.
- Global coverage depends on accessible/system-indexed and Wisp-indexed locations. The existing non-macOS filesystem fallback remains bounded. Unindexed or protected files are not guaranteed to appear. No permissions or indexing settings were changed.
- Full repository test suite and a new desktop package/release were not run for this scoped iteration.
