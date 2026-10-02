# Bundled ChatGPT connection tools

`prepare-tunnel-client.mjs` prepares OpenAI's unmodified full-client release
`v0.0.15` from <https://github.com/openai/tunnel-client/releases/tag/v0.0.15>.
The six archive hashes are pinned from that release's `SHA256SUMS.txt` and were
matched to the GitHub asset digests. Updating the pin requires reviewing the new
release, replacing the hashes, and validating the resulting application package.

The build and development hooks prepare the matching Rust target automatically.
Verified archives are cached in `.local-artifacts/tunnel-client/`; generated
executables and resource files are ignored by Git. No Homebrew installation is
used as a source. A modified cached archive stops the build; changed generated
outputs are restored from the verified archive.

Tauri's `externalBin` mechanism packages `tunnel-client` and `cloudflared` next to
the main executable, with `.exe` suffixes on Windows. Source filenames include
the Rust target suffix. This keeps the companion executable next to its client
after installation. The current macOS release and updater target Apple Silicon;
the preparation script also supports Intel macOS and the six reviewed official
GNU Linux/MSVC Windows targets, but those are not all runtime-tested here.

Resources under `bridge-runtime/` include the upstream `cloudflared-manifest.json`,
`LICENSE`, `NOTICE`, platform dependency license report, SPDX inventory, and
generated archive/file provenance. The companion manifest is embedded in the
upstream binary and its resource copy is retained for provenance. OpenAI's project
and the Cloudflared companion use Apache License 2.0; upstream notices and the
dependency report are retained unchanged.

The bundled executables enter the existing Tauri application signing and updater
packaging process. Preparation does not change Gatekeeper settings, remove
quarantine, sign manually, or claim Apple notarization. User tunnel identifiers,
API credentials, and directory authorizations are never packaged.

Tagged CI builds use `.github/tauri.ci.conf.json` to produce workflow artifacts
without updater signing keys or a machine-specific macOS certificate. They do
not publish or overwrite GitHub Release assets. The local `make-release.mjs`
script remains the publisher of the signed macOS release and updater index.
