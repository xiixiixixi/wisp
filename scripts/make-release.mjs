#!/usr/bin/env node
/**
 * Build and publish a Wisp release with self-update artifacts.
 *
 * What it does:
 *   1. Reads the version from apps/src-tauri/tauri.conf.json (single source of truth)
 *   2. Builds the app with the updater signing key so `Wisp.app.tar.gz` + `.sig`
 *      are produced next to the dmg
 *   3. Generates `latest.json` for the Tauri updater (darwin-aarch64)
 *   4. Tags `v<version>` and creates a GitHub Release with:
 *      Wisp_<ver>_aarch64.dmg           (fresh installs)
 *      Wisp_<ver>_aarch64.app.tar.gz    (updater package)
 *      latest.json                      (updater endpoint target)
 *
 * Usage:
 *   node scripts/make-release.mjs                       # build + publish
 *   node scripts/make-release.mjs --skip-build          # publish existing artifacts
 *   node scripts/make-release.mjs --notes-file NOTES.md # release notes body
 *
 * Required environment:
 *   ~/.tauri/wisp-updater.key must exist (minisign private key, no password).
 *   KEEP A BACKUP — losing it permanently breaks the self-update chain.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(import.meta.dirname, '..');
const CONF = join(ROOT, 'apps/src-tauri/tauri.conf.json');
const BUNDLE_DIR = join(ROOT, 'apps/src-tauri/target/release/bundle');
const STAGE_DIR = join(BUNDLE_DIR, 'release-stage');
const REPO = 'xiixiixixi/wisp';
const KEY_PATH = join(homedir(), '.tauri/wisp-updater.key');
const KEY_PASSWORD_PATH = join(homedir(), '.tauri/wisp-updater.password');

const SKIP_BUILD = process.argv.includes('--skip-build');
const notesFileArg = process.argv.find((a) => a.startsWith('--notes-file='));
const notesFile = notesFileArg ? notesFileArg.split('=')[1] : null;

const die = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });

// ── Preflight ────────────────────────────────────────────────────────────────
const version = JSON.parse(readFileSync(CONF, 'utf8')).version;
const tag = `v${version}`;
console.log(`▶ Releasing Wisp ${tag} → github.com/${REPO}`);

if (!existsSync(KEY_PATH) || !existsSync(KEY_PASSWORD_PATH)) {
  die(
    `Updater signing key not found at ${KEY_PATH} (+ password file). Generate with:\n` +
      `  PW=$(openssl rand -hex 16)\n` +
      `  echo -n "$PW" > ${KEY_PASSWORD_PATH}\n` +
      `  pnpm tauri signer generate -w ${KEY_PATH} -p "$PW"\n` +
      `Then put the new public key into tauri.conf.json plugins.updater.pubkey.\n` +
      `KEEP BACKUPS of both files — losing them permanently breaks self-updates.`,
  );
}

try {
  execSync(`git rev-parse ${tag}`, { stdio: 'pipe' });
  die(`Tag ${tag} already exists — bump the version in tauri.conf.json + Cargo.toml first.`);
} catch {
  // tag does not exist — good
}

try {
  execSync(`gh release view ${tag} --repo ${REPO}`, { stdio: 'pipe' });
  die(`GitHub Release ${tag} already exists.`);
} catch {
  // release does not exist — good
}

// ── Build ────────────────────────────────────────────────────────────────────
if (!SKIP_BUILD) {
  console.log('▶ Building (frontend + Rust release bundle, ~5 min)…');
  run('pnpm run build', {
    env: {
      ...process.env,
      // Tauri accepts a file path as TAURI_SIGNING_PRIVATE_KEY
      TAURI_SIGNING_PRIVATE_KEY: KEY_PATH,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: readFileSync(KEY_PASSWORD_PATH, 'utf8').trim(),
    },
  });
}

// ── Collect artifacts ───────────────────────────────────────────────────────
const appTar = join(BUNDLE_DIR, 'macos/Wisp.app.tar.gz');
const appSig = `${appTar}.sig`;
const dmg = join(BUNDLE_DIR, `dmg/Wisp_${version}_aarch64.dmg`);

for (const f of [appTar, appSig, dmg]) {
  if (!existsSync(f)) die(`Missing build artifact: ${f}\nRun a full build first (without --skip-build).`);
}

const signature = readFileSync(appSig, 'utf8').trim();

// Stage assets with release file names
rmSync(STAGE_DIR, { recursive: true, force: true });
mkdirSync(STAGE_DIR, { recursive: true });
const tarAssetName = `Wisp_${version}_aarch64.app.tar.gz`;
copyFileSync(appTar, join(STAGE_DIR, tarAssetName));
copyFileSync(dmg, join(STAGE_DIR, `Wisp_${version}_aarch64.dmg`));

// ── latest.json (updater endpoint) ───────────────────────────────────────────
const latest = {
  version,
  notes: notesFile ? readFileSync(notesFile, 'utf8') : `Wisp ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-aarch64': {
      signature,
      url: `https://github.com/${REPO}/releases/download/${tag}/${tarAssetName}`,
    },
  },
};
writeFileSync(join(STAGE_DIR, 'latest.json'), JSON.stringify(latest, null, 2));
console.log(`▶ latest.json written (signature ${signature.slice(0, 24)}…)`);

// ── Publish ─────────────────────────────────────────────────────────────────
console.log(`▶ Tagging ${tag} and creating GitHub Release…`);
run(`git tag ${tag}`);
run(`git push origin ${tag}`);

const notesArg = notesFile
  ? `--notes-file "${join(STAGE_DIR, 'release-notes.md')}"`
  : `--notes "Wisp ${version}"`;
if (notesFile) {
  copyFileSync(notesFile, join(STAGE_DIR, 'release-notes.md'));
}

run(
  `gh release create ${tag} --repo ${REPO} --title "Wisp ${version}" ${notesArg} ` +
    `"${STAGE_DIR}/Wisp_${version}_aarch64.dmg" ` +
    `"${STAGE_DIR}/${tarAssetName}" ` +
    `"${STAGE_DIR}/latest.json"`,
);

console.log(`✔ Released ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
console.log('  Updater endpoint: https://github.com/' + REPO + '/releases/latest/download/latest.json');
