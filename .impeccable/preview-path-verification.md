# Preview and trailing-path refinement — 2026-09-07

User scope: remove the repeated filename/size row above the preview; prioritize trailing directories on long paths; make preview/edit interactions dependable. Settings remain unchanged pending a separate decision.

## Changes

- Removed only the inspector context row, with no replacement spacer. The title, close control, collapsible metadata footer, and multi-selection navigation remain. Footer filenames now shrink correctly.
- PathBreadcrumbs measures the actual available trail width and label widths. It displays a contiguous suffix, preserving the current location; older ancestors remain in a keyboard-accessible, portaled menu. Full-path editing and ancestor drop targets remain available. Extremely narrow panes place the path beneath navigation controls.
- Markdown now uses shared accessible tabs and buttons. Markdown and HTML retain their editor buffers across mode switches and render a snapshot of the live draft. Save works while viewing that draft. In-flight saves cannot overwrite newer typing, duplicate pending writes, or write a retained buffer to a declined incoming file path.

## Evidence

- 80 tests passed across 9 focused suites: NavigationBar, PathBreadcrumbs, breadcrumb-layout, MarkdownPreview (including HTML draft contract), TextPreview, CodePreview, RightSidebar, glass-controls, and use-text-file-editor.
- TypeScript and production build passed. Existing Vite large-chunk warning remains.
- Changed production sources passed ESLint without errors or warnings; layout detector returned no findings; git diff --check passed.
- Browser demo: entered a test Markdown draft, switched to rendered preview, confirmed the new heading, switched back and confirmed the draft remained. The draft was discarded via reload without saving.
- Browser demo long path: /home/user/Documents/Research/2026/产品设计/苹果流体玻璃交互方案/Preview-and-Editing/Final. At 1643×865, the narrow split pane retained Final and exposed ancestors in the overflow menu. At 390×844, both panes wrapped navigation into 100px rails: Final remained 45px wide, each breadcrumb trail was 105px, document width remained 390px. All computed scrollbar-width values remained none.
- Read-only isolated layout assessment identified the duplicate rail, blanket 640px breadcrumb hiding, footer truncation, and editor conditional-unmount risks; those informed the implementation. The React review preserved lazy editor mounting, effect cleanup, stable save refs, and keyboard/tabpanel semantics.

## Captures and boundaries

Current captures: review/preview-path-wide.png, review/preview-path-edit-draft.png, review/preview-path-deep.png, review/preview-path-mobile.png. The latter two include the final overflow-menu material and narrow-navigation correction. The former two remain valid because their viewport/layout did not trigger the corrected narrow state.

No native files were modified during browser verification. Native save transport is covered through mocked API contracts, not real disk writes. Full application regression, native hotkeys, other preview types, screen-reader output, and native packaging were not verified in this refinement. Existing previous-turn verification files and captures are historical evidence, not verification of this later refinement. User-owned split layout was preserved and the first pane restored to Documents.
