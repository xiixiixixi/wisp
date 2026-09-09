# Glass and batch-interaction refinement — 2026-09-07

## Request and scope

The user rejected the earlier pale-blue reskin and uneven inspector geometry.
This revision changes the file workspace to a silver surround, lifted white
content and frosted inspector, with shared header/action rails. It preserves
the pinned Apple-inspired direction and existing file operations.
Settings controls and categories remain unchanged pending discussion.

## Verified

- TypeScript check and production frontend build pass. Existing bundle-size
  warnings remain; no native desktop package was built.
- 119 focused tests pass: selection commands, clipboard text/failure behavior,
  context-menu batch targets, selection properties, operation toolbar,
  file-operation helpers, shortcut normalization and shared keyboard controls.
- Three additional batch contract tests pass: file/folder copy task submission,
  collision-safe destinations with overwrite disabled, and visible-only menu
  selection/inversion. Total targeted passes: 122.
- Three older regression suites: 61 pass / 2 fail. Both failures reproduce
  on original HEAD bcb6a90a: localized copy-error title assertion and the
  context-menu backdrop-click test. No additional failed test names.
- Layout detector returned [] on the changed geometry targets.
- At 1153×865: navigation and inspector headers both y=64, height=64;
  selection action and inspector metadata rails both y=128, height=56.
- At 390×844: document width=390 on explorer and settings; no horizontal
  page overflow. All inspected DOM elements have scrollbar-width:none.
- Batch-properties list scrolls with End: scrollTop=232, scrollHeight=520,
  clientHeight=288, scrollbar-width:none, WebKit scrollbar display:none.
- ⌘A selects the eight visible demo entries, not the hidden ninth entry;
  status count also reports eight. Batch properties lists six files/two folders.
- Browser “Copy all paths” shows “Copied 8 paths, one per line” only after
  the clipboard promise resolves. Unit tests assert exact newline-delimited
  names/paths, including spaces and Chinese names, and rejection feedback.

## Evidence

Captures under `.impeccable/review/`:

- revision-user-1153.png
- revision-desktop.png (1440×900)
- revision-mobile.png (390×844)
- revision-batch-properties.png (1153×865)
- revision-settings-desktop.png (1153×865)
- revision-settings-mobile.png (390×844)

## Limits

Independent finish review: disposition `ship`, scoped to the six captures and
reviewed command wiring. All captures valid; no material fix requested in those
  states. This is not native runtime verification or user aesthetic approval.

After visual review, native source inspection identified that the old duplicate
action used file-only accelerated_copy_file. It now submits copy_with_progress
for files and directories with overwrite=false. Both native commands return a
background task id; duplicate feedback now says started, not completed. This
nonvisual contract fix has the three additional test passes above plus a fresh
TypeScript check and production build. It is not an executed native-copy result.

- Native clipboard hotkeys are blocked by browser automation. The actual
  Option+Command+C desktop gesture is not certified; the macOS ç/KeyC mapping,
  handler wiring and full-selection payloads are tested.
- Real native copy/move/delete/open/rename operations were not executed.
  No user files were changed by runtime tests.
- DOCX demo preview still genuinely fails to fetch its native asset in a browser.
  The new error layout and retry are not a claim of successful DOCX preview.
- Five unconsumed settings and the two animation toggles are documented in
  settings-simplification-proposal.md, not removed.
- Visual inspection does not establish the user's aesthetic approval.

Logs: /tmp/wisp-refinement-focused.log, /tmp/wisp-refinement-regression.log,
/tmp/wisp-refinement-baseline.log, /tmp/wisp-refinement-build.log,
/tmp/wisp-refinement-lint.log.
Additional contract log: /tmp/wisp-batch-native-contract.log.
