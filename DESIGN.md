---
name: Wisp
description: Apple-inspired Liquid Glass workspace with readable file content.
colors:
  xp-blue: "#0866d9"
  xp-blue-dark: "#0054b8"
  xp-on-accent: "#ffffff"
  xp-red: "#ba302b"
  xp-text: "#24262b"
  xp-text-secondary: "#555b66"
  xp-text-muted: "#616772"
  xp-bg: "#eff0f4"
  xp-selection-bg: "#dbe9fc"
  xp-selection-border: "rgb(8 102 217 / 26%)"
  lg-glass-clear: "rgb(255 255 255 / 26%)"
  lg-glass-regular: "rgb(255 255 255 / 58%)"
  lg-glass-strong: "rgb(252 252 253 / 94%)"
  lg-content-canvas: "rgb(255 255 255 / 94%)"
  lg-content-surface: "rgb(255 255 255 / 48%)"
  lg-content-surface-strong: "rgb(255 255 255 / 76%)"
  lg-control-fill: "rgb(255 255 255 / 48%)"
  lg-control-fill-hover: "rgb(255 255 255 / 78%)"
  lg-control-well: "rgb(28 30 36 / 6%)"
  lg-control-stroke: "rgb(40 43 51 / 14%)"
  lg-control-highlight: "rgb(255 255 255 / 92%)"
  lg-glass-stroke: "rgb(255 255 255 / 72%)"
  lg-glass-stroke-strong: "rgb(255 255 255 / 94%)"
  lg-divider: "rgb(40 43 51 / 10%)"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif'
    letterSpacing: "-0.008em"
  title: {fontSize: "1.25rem", fontWeight: 600, lineHeight: "1.75rem"}
  label: {fontSize: "0.75rem", fontWeight: 500, lineHeight: "1rem"}
  file-name: {fontWeight: 500}
  code:
    fontFamily: '"SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace'
    fontSize: "11px"
    lineHeight: 1.55
rounded:
  lg-radius-sm: "8px"
  lg-radius-md: "12px"
  lg-radius-lg: "16px"
  lg-radius-xl: "22px"
  lg-radius-pill: "999px"
  button-primary: "9px"
  field: "10px"
  segmented-item: "7px"
  workspace-pane: "20px"
spacing: {"0.5": "2px", "1": "4px", "1.5": "6px", "2": "8px", "3": "12px", "3.5": "14px", "4": "16px", "5": "20px"}
components:
  button-primary: {backgroundColor: "{colors.xp-blue}", textColor: "{colors.xp-on-accent}", rounded: "{rounded.button-primary}", height: "36px", padding: "0 14px"}
  button-primary-hover: {backgroundColor: "{colors.xp-blue-dark}"}
  button-outline: {backgroundColor: "{colors.lg-control-fill}", textColor: "{colors.xp-text}", rounded: "{rounded.field}", height: "36px", padding: "0 14px"}
  field: {backgroundColor: "{colors.lg-control-fill}", textColor: "{colors.xp-text}", rounded: "{rounded.field}"}
  segmented-active: {backgroundColor: "{colors.lg-content-surface-strong}", textColor: "{colors.xp-blue}", rounded: "{rounded.segmented-item}"}
  menu: {backgroundColor: "{colors.lg-glass-strong}", rounded: "{rounded.lg-radius-md}", padding: "5px"}
  dialog: {backgroundColor: "{colors.lg-glass-strong}", rounded: "{rounded.lg-radius-xl}"}
  batch-properties: {backgroundColor: "{colors.lg-glass-strong}", rounded: "{rounded.lg-radius-xl}", width: "32rem"}
  file-canvas: {backgroundColor: "{colors.lg-content-canvas}", rounded: "{rounded.workspace-pane}"}
  inspector: {backgroundColor: "{colors.lg-glass-regular}", rounded: "{rounded.workspace-pane}"}
  titlebar: {backgroundColor: "transparent", height: "64px"}
  navigation-header: {backgroundColor: "transparent", height: "64px", padding: "12px 16px"}
  inspector-header: {backgroundColor: "transparent", height: "64px", padding: "12px 16px"}
  action-rail: {backgroundColor: "transparent", height: "56px", padding: "8px 16px"}
---

# Design System: Wisp

## Overview

**Creative North Star: "Apple-inspired Liquid Glass workspace"**

Wisp is an always-light file workspace with a neutral silver ambient ground, a transparent titlebar/sidebar surround, a lifted white file canvas, and a frosted inspector. The canvas and inspector have matching rounded 20px edges; the previous blue wash has been replaced while blue remains the interaction accent. This documents the implemented, user-authorized redesign. The visual sequence supports navigating, selecting, previewing, and acting; this is a CSS material approximation, not Apple's native Liquid Glass renderer.

**Key Characteristics:**

- Neutral silver surround, white content, blue interaction accent, and system typography.
- Rounded sibling panes, aligned header/action rails, grouped controls, and stronger floating presentations.
- Readable content, visible keyboard focus, and opaque accessibility alternatives.

[PRODUCT.md](PRODUCT.md) owns product truth. [main.tsx](apps/client/src/main.tsx) imports index.css, then [liquid-glass.css](apps/client/src/styles/liquid-glass.css), then [fluid-glass.css](apps/client/src/styles/fluid-glass.css). Final `html.theme-fluid` selectors govern active material; base rules remain where not overridden. Root tokens reach body portals; SkySync retains light appearance and toggles fluid treatment.

Frontmatter is normative for normal fluid mode: color keys map to CSS variables with leading `--`; `lg-radius-*` keys are source variables, other radii are observed component values, and spacing keys are existing Tailwind steps. The batch-properties width records the modal's maximum width, bounded by viewport margins. Sidecar snippets are static state illustrations with CSS interactions; production keyboard behavior stays in React components.

Primary evidence is [.impeccable/refinement-verification.md](.impeccable/refinement-verification.md) and the six captures in [.impeccable/review/](.impeccable/review/): revision-user-1153.png, revision-desktop.png, revision-mobile.png, revision-batch-properties.png, revision-settings-desktop.png, and revision-settings-mobile.png. Independent finish review returned `disposition: ship` scoped to those six captures and reviewed command wiring. Final handoff verification reports passing TypeScript/build checks and 122 targeted tests (119 focused tests plus three batch-contract integration tests); older regression suites have 61 passes and two failures reproduced on baseline HEAD bcb6a90a. The subsequent nonvisual duplicate-command correction leaves all six captures valid, with no layout correction after review. [Earlier verification](.impeccable/verification.md) and its desktop.png, mobile.png, settings-desktop.png, search-mobile.png, and workspace-dialog.png captures remain historical evidence of the previous state.

The native Option+Command+C gesture and real filesystem operations were not verified; real search, extensions, and desktop packaging remain unverified. The DOCX browser demo still fails to fetch its native asset: the visible error/retry treatment is not successful DOCX preview. Scoped review does not establish user taste approval or full-suite/native success.

Subsequent user feedback removed the duplicate inspector metadata rail and requested trailing-path priority. Current evidence for these changes and draft-preserving preview/edit behavior is [preview-path-verification.md](.impeccable/preview-path-verification.md): 80 focused tests, TypeScript/build, lint and browser checks passed. The six earlier refinement captures above are historical for these subsequently changed surfaces.

## Colors

Primary: `xp-blue` marks primary actions, active tabs, checked controls, and focus; `xp-blue-dark` supplies primary hover/current navigation. Selection fill and border remain visible during hover. `xp-red` marks destructive/invalid states. Existing file-icon and tag colors retain their semantics.

Neutral: text/secondary/muted separate reading, supporting labels, and placeholders. The silver ambient ground shows through the transparent titlebar and sidebar surround. Regular glass frosts the inspector; strong glass protects floating content, and the white content canvas protects filenames and previews.

`--xp-accent` and legacy `--xp-lime` alias blue in fluid mode; `--primary`/`--ring` follow it. Sidebar/chrome/inspector/popover aliases still map to clear/regular/regular/strong, but final titlebar/sidebar selectors explicitly use transparent backgrounds and no backdrop blur; border maps to divider. Fluid overrides the text, background, and surface RGB variables; other inherited RGB utilities remain subject to final component selectors.

**The Material Precedence Rule.** Resolve active root aliases and the final fluid selector before borrowing a value from inherited CSS or a utility class.

## Typography

The inherited glass body's important system-font declaration supersedes the earlier index stack. No display face or invented ratio is introduced. Preserve mixed Chinese/English legibility. The interface uses a fixed 14px root size; user font-size controls were removed on 2026-09-08. Standard browser zoom remains available.

Shared dialog titles use the title role; compact controls use label. Default buttons/fields use text-sm (0.875rem/1.25rem), buttons at weight 500; small/large buttons use text-xs/text-base. File-row names use the file-name role with an explicit weight 500 override. The titlebar brand is 15px/700. Code previews use the mono role.

## Layout

The first workspace viewport has a 64px titlebar, default 240px sidebar, flexible white content canvas, and optional 320px frosted inspector (initially closed). Saved pane widths remain authoritative; sidebar/inspector resize within 180–480px/240–560px. Canvas and inspector share top/bottom edges, with resize handles in the gutter. Workspace outer padding is `0 12px 8px 0`, changing to `0 8px 8px` at ≤700px; content gutters are 16px.

Navigation and inspector headers use a 64px minimum with `12px 16px` padding. Navigation wraps its path beneath the navigation controls when an extremely narrow pane cannot preserve 140px for the address field. The file action rail is 56px tall with `8px 16px` padding. The duplicate inspector filename/size rail is removed at the user's request; file identity stays in the collapsible footer. Selection changes the action rail without moving the file content; preview content has 16px padding.

[use-layout-state.ts](apps/client/src/hooks/use-layout-state.ts) folds inspector then sidebar below 560px remaining content width; automatically hidden panes restore only when their inclusion leaves at least 640px. User closures win. Bottom panel folds below 460px viewport height and restores at 540px only if automatically hidden.

| Actual condition | Response |
| --- | --- |
| Viewport ≤1100px | Hide titlebar split-action group; tighten primary toolbar padding. |
| Viewport ≤920px | Titlebar inner padding 12px; horizontal rail buttons 30px wide. |
| Viewport <820px / ≥820px | Compact search button / centered command pill, same palette action. |
| Viewport ≤700px | Settings category scroll strip, wrapping rows, titlebar weather hidden. |
| Breadcrumb available width | Measure actual labels, retain the current directory then nearest ancestors; earlier ancestors are accessible in a leading overflow menu. Full-path editing stays available. |
| File-pane container ≤640px / ≤520px | Hide type / then date; retain filename and size. |
| Content container ≤390px | Compact toolbar; hide Size Map and status accessory. |
| Named action-rail container ≤640px | Hide selection-action and clear labels, hide redundant count badge, tighten action-button padding to 8px. |
| Named action-rail container ≤390px | Limit summary text to 64px; action-button padding 6px and clear-button padding 4px. |
| Tailwind lg ≥1024px / xl ≥1280px | Reveal preview/delete labels / further selection and new-folder labels; action-rail container rules override selection labels when the pane is narrow. |

Selection summary/actions and the action group do not wrap. The outer row has an 8px gap; the grouped action controls have a 2px gap and 2px inset. Named action-rail container rules keep narrow panes usable with icons even in wide windows. Settings rows retain 64px minimum height and wrap only at the existing mobile breakpoint. Explorer and settings captures at 390×844 have document width 390px with no horizontal page overflow.

Shared dialogs scroll internally with 16px side margins and maximum height `min(90dvh, calc(100dvh - 40px))`. Their `maxWidth` prop applies to the actual modal, not an inner wrapper; batch properties sets it to 32rem and has a focusable list capped at 18rem with vertical scrolling.

All scrollbars stay hidden in every theme, including while scrolling. Final [index.css](apps/client/src/index.css) rules set `scrollbar-width: none`, `scrollbar-gutter: auto`, and `-ms-overflow-style: none` with important precedence, hide WebKit scrollbars with zero dimensions, and hide Monaco/Radix custom rails. Existing overflow behavior is preserved; the old auto-scrollbar listener is no longer imported or installed in main.tsx. In the recorded batch-list End-key check, scrollTop reached 232 with scrollHeight 520 and clientHeight 288 while both scrollbar implementations remained hidden.

## Elevation & Depth

Clear/regular/strong blur tokens remain 14/24/32px; frosted pane saturation is 145%, controls/presentations 150%. Titlebar and sidebar surround are transparent with no backdrop filter; content rows and nested navigation/operation bars avoid individual backdrop filters. `--lg-specular` supplies a diagonal highlight. Normal-fluid `--lg-ambient` is `radial-gradient(ellipse at 0% 100%, rgb(205 215 229 / 48%), transparent 60%), linear-gradient(125deg, #e7e9ee, #f6f6f8 55%, #e8eaf0)`, producing the measured neutral silver surround.

The file canvas and inspector share a restrained lift: `0 2px 8px rgb(30 34 44 / 5%), 0 12px 32px rgb(30 34 44 / 4%)`. Settings cards use `0 1px 4px rgb(30 34 44 / 5%)`.

`--lg-control-shadow` combines inset light and short ambient shadows; `--lg-shadow-elevated` separates presentations and is aliased by `--xp-shadow-popover`. The sidecar carries exact values. Older `--lg-shadow-control` is a distinct inherited token, not the current control-shadow alias.

**The Shared Glass Rule.** Give each control group one material body; keep its child controls transparent until hover or selection, and keep file rows still.

Fast/medium motion tokens are 180/220ms, using inherited `--lg-ease` and `--lg-spring`. Eligible controls press to scale 0.97; generic button scale resets to 1. Independent scale preserves positioning transforms.

Final reduced-transparency/high-contrast classes and matching media preferences replace plane fills with opaque colors and disable descendant/pseudo-element blur, including portals. High-contrast class strengthens strokes/text; unsupported blur gets opaque fallbacks. Reduced-motion class/media use 0.001ms durations and no press scaling; the class also disables smooth scrolling.

## Shapes

The white file canvas and frosted inspector have matching 20px corners and no border; settings content also uses 20px corners. The transparent titlebar/sidebar surround stays unrounded. These component values do not replace the valid fluid radius scale: primary/ghost/destructive buttons and file rows 9px; outline/secondary buttons and fields 10px; segmented items 7px; groups/anchored menus 12px; settings cards 16px; dialogs 22px; command pill 999px. The inherited important `[role="dialog"], .elevated-glass` rule uses `--lg-radius-xl`, resolved to 22px in fluid mode, overriding shared dialog utility rounding. Anchored-menu children retain the base important 7px radius; other menu items/options use 8px.

## Components

[Button](apps/client/src/components/ui/button.tsx) defaults to type=button; default/outline/ghost/destructive/secondary variants are blue/light glass/transparent/red/light glass. Small/default/large heights resolve to 32/36/44px (fluid minimum raises small from 28px), horizontal padding 10/14/20px. Primary hover darkens; neutral hover lightens; eligible controls compress on press. Native disabled controls dim and stop scaling; shared buttons also block pointer events.

Focus-visible uses a 2px blue outline with 2px offset. Fields use inset fill, muted placeholders, blue caret, and red invalid border; final field specificity replaces the base focus glow. [Select](apps/client/src/components/ui/select.tsx) preserves Radix behavior, a 36px trigger, checked indicators, and a portal bounded by available height or 24rem; focused/highlighted options use selection fill with 32px minimum height.

[TopBar](apps/client/src/components/explorer/TopBar.tsx) uses responsive triggers for one search action. [NavigationBar](apps/client/src/components/explorer/NavigationBar.tsx) groups back/forward/up/refresh with editable path and current-location semantics. [OperationBar](apps/client/src/components/explorer/OperationBar.tsx) switches from sort/view/create controls to selection actions: preview for one, properties for single or multiple entries, compression for multiple, paste when clipboard content exists. File rows keep 44px minimum height, weight 500 names, 2px separation, and selection fill through hover.

[RightSidebar](apps/client/src/components/panels/RightSidebar.tsx) always shows the panel title and close control in its 64px header. Single-file metadata appears only in the collapsible footer, leaving preview and editing directly below the header. Multi-selection retains the 56px [PreviewNavigationBar](apps/client/src/components/panels/PreviewNavigationBar.tsx). Markdown uses shared accessible segmented tabs; Markdown and HTML preserve the live editor and undo state across mode switches and render the current draft. Save completion does not overwrite newer typing. [PreviewPanel](apps/client/src/components/panels/PreviewPanel.tsx) supplies a labeled error state, explanation, actual error text, and retry button when asset loading fails; the reviewed DOCX remains in this error state.

[selection-commands.ts](apps/client/src/lib/selection-commands.ts) wires full-selection properties, duplicate, open, rename, and copy-path commands into use-wisp-effects.ts. Single-entry behavior remains; multi-entry properties aggregate, multi-rename delegates to bulk rename, and multi-open delegates each file/folder to its existing action. Copy-path retains selected paths even during a list refresh. Context-menu copy-name/copy-path/properties also pass the full selection. [copy-entry-text.ts](apps/client/src/lib/copy-entry-text.ts) serializes names or paths one per line, awaits the clipboard write before reporting success, and reports rejection as a destructive error. Select All and the status count use visible filtered entries; the recorded fixture selects eight entries, excluding the hidden ninth. These are implemented command contracts and scoped test evidence, not native filesystem/hotkey certification.

[duplicateFiles](apps/client/src/hooks/use-file-operations.ts) now calls `copyWithProgress(source, destination, false)` for both files and directories, refusing overwrite; the replaced `acceleratedCopyFile` was file-only. Native acceptance returns a background task ID, so the toast says “Creating duplicates” and “Started N items. Check transfer progress for the result.” It reports queued/started work, not completed copies. No native files were actually copied during verification.

[Tabs](apps/client/src/components/ui/tabs.tsx) uses a shared track and blue active segment. Only the active tab is tabbable; Left/Right wrap and select with RTL support, Home/End select endpoints, and disabled tabs are skipped. Linked inactive panels are hidden/empty; active panels remain keyboard focusable.

[AnchoredMenu](apps/client/src/components/ui/AnchoredMenu.tsx) portals to body with fixed positioning, 8px gutter, upward flipping, and bounded scrolling. Operation menus open first item via click/Enter/Space/ArrowDown, last via ArrowUp; arrows wrap, Home/End jump. Escape/activation restore trigger focus; Tab/Shift+Tab close and continue from its document position. Outside interaction dismisses.

[Dialog](apps/client/src/components/ui/dialog.tsx) provides modal labeling, explicit-autofocus/first-control/container focus priority, Tab trapping, conditional Escape/backdrop dismissal, and focus restoration on close/unmount; nested handled portal events retain ownership. Its optional `maxWidth` styles the element with `role="dialog"`; the default remains max-w-4xl. Shared content padding is 20px; backdrop blur is 8px. Workspace row actions reveal on focus-within and non-hover devices. Recorded search dismissal restores the visible trigger.

[SelectionPropertiesDialog](apps/client/src/components/dialogs/SelectionPropertiesDialog.tsx) opens for more than one entry with `maxWidth="32rem"`. It shows file/folder counts and total file bytes excluding folder contents, then a keyboard-focusable, vertically scrollable list of every selected name, path, and size/type. “Copy all paths” delegates the exact selection to the awaited clipboard handler. The reviewed eight-entry state contains six files and two folders.

[Settings](apps/client/src/pages/settings.tsx) keeps the silver surround, transparent header/sidebar, 20px content plane and 16px white groups. The user-approved first simplification on 2026-09-08 reduces 12 categories to 9: General only exposes language and reset on macOS; Windows retains applicable shell integration. File associations and context-menu rules are collapsed disclosures inside File Explorer. Font-size and Accessibility controls are deleted, along with animation, weather display/city, glass, sidebar-width, notification, auto-save and Markdown-preview settings. Weather remains editable in the titlebar, hidden files toggle beside search, file previews retain their own edit controls, and sidebar resizing remains direct manipulation. Retired preferences are stripped on startup/import; light glass is fixed and system accessibility media queries remain effective. This supersedes the earlier pending simplification proposal for these controls, without implementing the broader 12-to-5 regrouping.

The final cleanup leaves five categories: General, File Explorer, Indexing, Shortcuts, and About. The user requested removing the underlying retired features as well as their controls. File snapshots are removed from settings, file context menus, dialog state/rendering, Tauri commands, Rust storage implementation, SDK wrappers, extension APIs, and translations. File-operation audit collection, persistence, query/export APIs, and the performance-panel audit feed are removed too. Settings backup/import/export and automatic extension installation on update are retired; obsolete storage keys and snapshot context-menu rules are migrated. Old preference-specific accessibility CSS is removed, while system preference media queries and normal keyboard access remain.

No existing files, snapshots, backups, or audit records on disk are erased. Normal file operations, undo/redo, Git, extension runtime, and Agent safety/rate-limit logs are retained. Marketplace browsing and manual installation/update remain pending a separate scope decision; removal of its settings page is not authorization to dismantle all extension infrastructure.

Cleanup verification: 134 focused frontend tests and 62 Rust file-operation/encryption/compression/secure-delete tests pass. TypeScript, Rust library/binary checks, frontend build, and static Chinese/English key checks pass. The older performance/file-operation integration selection remains at 48 passes and 24 failures; every remaining failure was already present in the initial run of this cleanup. Chinese/English five-category navigation and the final Chinese settings screen were checked in the browser. No native application install or release was performed.

## Do's and Don'ts

- Do preserve the always-light silver surround, white canvas, frosted inspector, and user-selected Liquid Glass direction.
- Do reuse final fluid tokens, shared controls, keyboard focus, and saved pane preferences.
- Do keep filenames, selection, previews, and current location readable at narrow widths.
- Do keep the 64px titlebar/header rhythm, 56px action rail, nonwrapping selection controls, 44px file rows, and 16px content gutters. Wrap extremely narrow path navigation rather than hiding the current directory; do not repeat inspector footer metadata above the preview.
- Do hide all scrollbars in every theme, including while scrolling, while preserving overflow and keyboard scrolling.
- Do keep the 5-category simplified settings and the collapsed file-association/context-menu entries; do not restore retired feature APIs, appearance controls, removed settings pages, or tutorials.
- Do act on the full selection and await clipboard success or failure before showing feedback.
- Do describe duplicate requests as queued/started background tasks; a returned task ID does not mean the copy completed.
- Do honor opaque materials, stronger contrast, and reduced motion.
- Don't add per-row backdrop blur or press movement to file/navigation rows.
- Don't revive inherited paper texture or weather-driven dark appearance.
- Don't treat component previews or browser fixtures as native-runtime validation.
- Don't infer native hotkey/filesystem success, successful DOCX preview, or user taste approval from the scoped ship disposition.
