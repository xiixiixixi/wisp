# Liquid Glass verification

Date: 2026-09-07. Baseline: `bcb6a90a`. Preview: `http://127.0.0.1:5190/?demo=1`.

## Scope

Apple-inspired web materials for the existing React/Tauri file manager. This is
a CSS material approximation, not Apple's native Liquid Glass renderer. The
existing always-light appearance and opt-out/accessibility preferences remain.

## Automated checks

- `pnpm exec tsc --noEmit`: passed.
- `pnpm frontend:build`: passed. Existing large-chunk warning remains.
- ESLint on changed production TS/TSX: no errors; three pre-existing nested
  ternary warnings in HomePage remain.
- `git diff --check`: passed.
- 26 relevant Vitest suites: 488 passed, 43 failed, 531 total. Scope includes
  all existing dialog suites, settings, search, navigation/operation/title bars,
  new shared-control tests, and new global-shortcut/control regression test.
- Read-only HEAD archive baseline: 48 failures. All 43 remaining failures are
  present in that baseline; no new failure names. Five baseline failures resolved
  (file-size mock expectation, layout empty state, layout name input/save, and
  platform-specific shortcut hint). New tests add shared-dialog/tabs/button,
  focus restoration, weather preference, menu keyboard and shortcut arbitration
  coverage. This is not a claim that the repository's full test suite is green.
- Design detector ran once and returned no findings.

## Browser checks

- 1280 × 720: continuous window, navigation, file selection, contextual actions,
  rendered Markdown inspector, menus, settings and floating layout dialog.
- 390 × 844: name/size file list, compact search, full current-folder label,
  ancestor-path editing, scrollable settings categories, wrapping setting rows.
  No document horizontal overflow observed.
- Enter opens sorting and moves focus into its menu. Tab closes it and focuses
  the view trigger. Unit tests also exercise Space and Shift+Tab.
- Escape closes search and restores the visible compact search trigger.
- Blue selected search mode matches the primary interaction accent.
- Layout row actions become opaque on keyboard focus (`opacity: 1`). A single
  synthetic layout used for this check was removed through its own delete button.
- Reduced transparency produces opaque surfaces with no backdrop filter;
  disabling animation applies the reduced-motion class and near-zero duration.
  Preferences were restored after the checks.
- Actual viewport override reset after captures.

Screenshots are in `review/`. `workspace-dialog-before.png` is diagnostic
before-fix evidence; `workspace-dialog.png` is the corrected result.

## Limits

Browser fixtures are synthetic and enabled only by the existing DEV demo mode.
Native filesystem operations, real search results, extension loading and Tauri
desktop packaging were not verified. Native-only calls produce expected errors
in this browser preview; do not interpret it as a native end-to-end acceptance run.

Primary material guidance: https://developer.apple.com/design/human-interface-guidelines/materials

## Design review

Impeccable's independent finish review first returned `fix`. One correction batch
addressed menu keyboard entry/exit and shortcut arbitration, layout-row focus
visibility, narrow-window current-directory priority, the search-mode accent,
localized layout-dialog footer, and visible tab-panel focus. The reviewer
re-read the recaptures and returned `ship`: all six findings resolved, no
regression observed in those captures. That verdict covers the six scored fixes,
not untested native features or every legacy extension surface.
