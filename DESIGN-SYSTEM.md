# Wisp macOS component system

The current design source is `apps/client/src/styles/design-system.css`, loaded after the legacy layout styles. This replaces the former warm paper/serif appearance. Earlier Anthropic/MUJI appearance notes describe a retired direction.

## Sources and fidelity

- [Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials): separate the functional Liquid Glass layer from content; favor regular material for text-heavy surfaces; adapt to transparency and contrast preferences.
- [Apple HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color): semantic colors, restrained tinting, distinct light and dark appearances.
- [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons): clear hierarchy, consistent groups, labels, and press feedback.
- [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): macOS default control target 28 pt, minimum 20 pt; default type 13 pt, minimum 10 pt; readable contrast and keyboard operation.
- [macOS 27 Community Figma](https://www.figma.com/design/FN9QfcdXcs3pZdzJT7zzVc/macOS-27--Community-?node-id=207-14494): visual reference, not an Apple specification. The linked node is the Sliders and Dials page. Its slider example `4352:11095` was read through design context: 6 px track, blue `#0088ff`, white 24 × 20 px capsule thumb, subtle shadow. Existing same-file button and toggle reference images were also visually inspected.

The macOS window now uses AppKit material in `apps/src-tauri/src/native_material.rs`: a behind-window Sidebar material samples the desktop, and macOS 26+ adds a Regular `NSGlassEffectView` above it. Older macOS uses Sidebar vibrancy. The transparent WebView sits above this backing; file browsing shares the continuous window material; document editors and previews retain protected content surfaces. The successful native setup publishes `data-native-material`, which is required before CSS clears the root background. Browser previews use a subtle pearl/silver backing with faint warm-gray and lilac gradients underneath one translucent shell because they cannot sample the desktop. This is an explicit full-window visual direction, not an Apple requirement that every content surface use Liquid Glass.

The actual Materials pages (`483:9316`, light; `488:17448`, dark), toolbar page `207:14501`, and window examples `4440:8153`/`4440:8165` were inspected during the correction. The kit's native Figma GLASS effect is not represented faithfully in its generated CSS. Web controls approximate its fine dark contour, bright optical rim, neutral translucent fill, and soft shadow; they are not AppKit controls or an exact recreation of Apple's refraction renderer. Exact CSS values below are implementation choices, not HIG requirements.

## Component contract

| Family | Wisp treatment |
| --- | --- |
| Title bar, sidebar, inspector | Continuous native window backing; sidebar and header reveal it; the inspector has a separate elevated surface |
| Toolbar groups, search control | Shared rounded material background; child controls don't stack blur |
| Bottom drawer | Translucent continuation of the backing, one segmented tab track, arrow/Home/End navigation, state-preserving terminal tabs and transparent xterm canvas |
| File lists and grids | Continuous window backing, equal 16 px gutters, no white card or decorative dividers; sticky column labels gain protection only after scrolling |
| Document previews and settings cards | Protected standard content surfaces |
| Buttons | 13 px system text; 28 px regular, 24 px small, 36 px large; capsule corners and optical rim; primary/secondary/outline/ghost/link/destructive states |
| Input, textarea, select | Text fields use inset standard material; popup selects use a glass capsule; visible focus and invalid/disabled treatment |
| Checkbox | Check, minus for mixed selection, disabled state, native Radix semantics |
| Switch | 36 × 20 px capsule with 16 px white thumb; accessible row name/description; Space activation |
| Slider | Native range semantics, filled track and capsule thumb; media-specific track styles remain supported |
| Tabs | One inset segmented track, neutral selected segment; arrow/Home/End navigation skips disabled tabs |
| Menu, popover, select list | Regular material with text protection, 18 px container corners, arrow-key selection and visible focus |
| Dialog | Thicker regular surface, 26 px container corners, dark scrim, autofocus/trap/restore |
| Card, badge, separator | Quiet content grouping and semantic labels; no decorative glass stacking |
| Toast/notification | Elevated regular material; shared fields/buttons, reduced-motion progress |
| Terminal and charts | Semantic light/dark colors; readable content surfaces |

Use `--ds-*` for new component styles. The `--xp-*`, shadcn, and `--lg-*` names remain mapped for existing consumers. Preserve saved panel widths. File row geometry is 40 px with no external row margin, matching the virtual-list estimate. The top bar is 72 px with a 64 px inner title row, leaving 24 px between the search capsule and context controls. The combined context toolbar is 48 px; selected-file actions replace navigation in that same row. Narrow split panes wrap the context toolbar. The browser footer centers its count and visually hides the duplicated path while keeping it available to assistive technology.

## Color and typography

The interface uses `-apple-system` / SF Pro, with PingFang fallback. Code retains a system monospace stack. Body controls use 13/18 px; secondary descriptions use 12/17 px; captions use 10–11 px. The root remains 16 px so existing Tailwind spacing is stable. Do not force a serif face onto navigation or file names.

The Figma decorative blue is `#0088ff`. Small text and filled buttons use deeper `#006bd6` to meet contrast with white. In dark appearance, link text uses `#64b5ff`; white-on-blue actions keep the deeper control fill. Do not reuse a filled-control color for small dark-mode text.

Main tokens: `--ds-label-primary`, `--ds-label-secondary`, `--ds-label-tertiary`, `--ds-canvas`, `--ds-surface`, `--ds-field`, `--ds-control`, `--ds-separator`, `--ds-accent`, `--ds-link`, `--ds-focus`, `--ds-scrim`. The quaternary label is for inactive graphics, not explanatory text.

## Appearance and accessibility

General settings exposes Follow system / Light / Dark through native radio choices. The validated `appearance` field in `wisp:settings` persists this choice; older theme names remain retired. SkySync and the first-paint boot script use the same resolution, including live OS changes in system mode and cross-window storage events. Explicit modes remain stable when the OS appearance changes. Tauri `setTheme(light | dark | null)` synchronizes the app-wide native material without changing OS preferences; a temporary CSS veil protects text until native confirmation. This is an appearance setting, not an independent sunset scheduler. `theme-fluid` identifies shared layout; `theme-light` / `theme-rolex` identify polarity.

- Reduce Transparency: opaque functional surfaces and no backdrop filtering. The native bridge observes NSWorkspace accessibility preferences because WebKit does not expose every setting as a media query; native effects hide and the window becomes opaque.
- Increase Contrast: opaque surfaces, stronger separators, brighter/darker secondary text and control boundaries.
- Reduce Motion: remove transitions and repeated animation while preserving switch/selection position. Window highlights follow the pointer through at most one animation-frame update; reduced motion centers that highlight and cancels pending updates. There is no idle animation.
- Forced Colors: use system Canvas, ButtonFace, Highlight and text colors.
- Keyboard focus: 3 px system accent ring; inset inside menu/address boundaries.
- Content and menu selection must survive hover; disabled controls must not activate.

Legacy CSS still supplies structural layout. Keep final appearance and accessibility overrides together here; avoid creating another override stylesheet. When adding a component, verify both polarities and media preferences in the specimen and its real feature screen.

## Local verification

Run the frontend with the installed toolchain (`node node_modules/vite/bin/vite.js`). Open `/component-preview.html` for the development-only interactive specimen using real shared components. The default production Vite build includes only `index.html`.

React transforms are restricted to workspace source. This prevents a custom Vite cache outside `node_modules` from being recompiled as application code and breaking dependency Hook order. `node --test scripts/test-react-transform.mjs` verifies both the excluded cache and included application component.

Native material changes require rebuilding the application; a browser or an older installed Wisp cannot verify them. The standalone `apps/src-tauri/target/review/Wisp Glass Preview.app` verified the native material bridge in the previous correction; it predates the latest browser layout correction and must be rebuilt before reviewing that layout natively.

See `docs/apple-components-validation.md` for the current validation results and known limits.
