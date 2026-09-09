# Address-bar website recognition — 2026-09-08

Scope: user request to open addresses without typing `https://`. Preserved prior uncommitted global-search/icon/breadcrumb work; no settings changes, version bump, commit, push, or release.

## Behavior

- `addressToWebUrl` normalizes bare domains to HTTPS and localhost/private IPv4/loopback addresses to HTTP. Explicit HTTP/HTTPS stays explicit. Paths, query strings, fragments and IDN domains use the standard URL parser.
- Absolute, home-relative, relative, Windows and UNC paths remain paths. Common ambiguous document suffixes stay file-oriented; explicit HTTP/HTTPS overrides that heuristic. Existing local items matching a domain-like input take precedence on submit.
- Website input bypasses directory completion and filesystem validation. Generation guards discard stale asynchronous file results. Enter confirms a website; blur does not silently open it. IME confirmation is not interpreted as navigation. Existing click-background, overflow-menu and Shift+Command+G editing remain.
- Existing navigation creates/activates a web tab with the normalized URL. Browser preview now explains that embedded web rendering is native-only and exposes a real `noopener noreferrer` link, instead of an empty pane. The native resize listener is removed on cleanup.

## Evidence

- 110 tests pass in seven focused suites: address-url (44), NavigationBar (29), WebTabView (2), plus previous CommandPalette (14), FinderFileIcon (11), global-file-search (5), breadcrumb-layout (5).
- Native view contract test confirms `web_tab_create` receives the full URL and bounds, plus cleanup/destroy calls. This is mocked IPC, not a real macOS webpage-loading test.
- Targeted ESLint and TypeScript pass. Production build passes (16.60s; existing bundle/import warnings remain), log `/tmp/wisp-address-url-build.log`. `git diff --check` passes.
- Browser at 942×865: entering `github.com` in the address bar created a github.com web tab with exact link `https://github.com/`. Entering `localhost:5190/?demo=1` created a localhost tab with exact link `http://localhost:5190/?demo=1`. Click-background editing and the existing focus shortcut were exercised.
- 390×844: browser-fallback copy wraps and the open link remains visible without text overflow. Captures: `review/address-url-desktop.png` and `review/address-url-mobile.png`. Temporary viewport override reset; test web tabs removed.
- No external website was loaded or authenticated during verification. Native webpage rendering remains dependent on the installed desktop app and destination/network policy; this turn did not rebuild a desktop installer.
