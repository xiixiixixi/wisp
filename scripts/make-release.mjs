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
 *   ~/.tauri/wisp-updater.key and ~/.tauri/wisp-updater.password must exist.
 *   KEEP BACKUPS — losing them permanently breaks the self-update chain.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { execFileSync, spawnSync } from 'child_process';

const ROOT = resolve(import.meta.dirname, '..');
const CONF = join(ROOT, 'apps/src-tauri/tauri.conf.json');
const BUNDLE_DIR = join(ROOT, 'apps/src-tauri/target/release/bundle');
const STAGE_DIR = join(BUNDLE_DIR, 'release-stage');
const REPO = 'xiixiixixi/wisp';
const KEY_PATH = join(homedir(), '.tauri/wisp-updater.key');
const KEY_PASSWORD_PATH = join(homedir(), '.tauri/wisp-updater.password');

const die = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

const run = (command, args, opts = {}) =>
  execFileSync(command, args, { stdio: 'inherit', cwd: ROOT, ...opts });

const capture = (command, args) => {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    die(`${command} ${args.join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`);
  }
};

const parseArgs = (args) => {
  let skipBuild = false;
  let notesFile = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--skip-build') {
      skipBuild = true;
    } else if (arg === '--notes-file' || arg.startsWith('--notes-file=')) {
      if (notesFile !== null) die('--notes-file may only be given once.');
      const value = arg === '--notes-file' ? args[++i] : arg.slice('--notes-file='.length);
      if (!value || value.startsWith('--')) die('--notes-file requires a file path.');
      notesFile = resolve(value);
    } else {
      die(`Unknown argument: ${arg}`);
    }
  }
  return { skipBuild, notesFile };
};

const { skipBuild, notesFile } = parseArgs(process.argv.slice(2));

const assertGitReady = (tag) => {
  if (capture('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== 'main') {
    die('Release must run from the main branch.');
  }
  if (capture('git', ['status', '--porcelain=v1', '--untracked-files=normal'])) {
    die('Working tree is not clean. Commit or remove local changes before releasing.');
  }

  const head = capture('git', ['rev-parse', 'HEAD']);
  const remoteMain = capture('git', ['ls-remote', '--heads', 'origin', 'main']).split(/\s+/)[0];
  if (!remoteMain || head !== remoteMain) {
    die('main HEAD differs from origin/main. Push the release commit before releasing.');
  }

  const localTag = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  if (localTag.error || (localTag.status !== 0 && localTag.status !== 1)) {
    die(`Could not check local tag ${tag}: ${localTag.error?.message || localTag.status}`);
  }
  if (
    localTag.status === 0 ||
    capture('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  ) {
    die(`Tag ${tag} already exists. Bump the version before releasing.`);
  }
};

// ── Preflight ────────────────────────────────────────────────────────────────
const version = JSON.parse(readFileSync(CONF, 'utf8')).version;
const tag = `v${version}`;
console.log(`▶ Releasing Wisp ${tag} → github.com/${REPO}`);

assertGitReady(tag);

const notes = notesFile ? readFileSync(notesFile, 'utf8') : `Wisp ${version}`;

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

// ── Build ────────────────────────────────────────────────────────────────────
if (!skipBuild) {
  console.log('▶ Building (frontend + Rust release bundle, ~5 min)…');
  run('pnpm', ['run', 'build'], {
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
  if (!existsSync(f))
    die(`Missing build artifact: ${f}\nRun a full build first (without --skip-build).`);
}

const signature = readFileSync(appSig, 'utf8').trim();
if (!signature) die(`Empty updater signature: ${appSig}`);

// Stage assets with release file names
rmSync(STAGE_DIR, { recursive: true, force: true });
mkdirSync(STAGE_DIR, { recursive: true });
const tarAssetName = `Wisp_${version}_aarch64.app.tar.gz`;
const dmgAssetName = `Wisp_${version}_aarch64.dmg`;
const assetPaths = [
  join(STAGE_DIR, dmgAssetName),
  join(STAGE_DIR, tarAssetName),
  join(STAGE_DIR, 'latest.json'),
];
copyFileSync(appTar, assetPaths[1]);
copyFileSync(dmg, assetPaths[0]);
const stagedNotes = join(STAGE_DIR, 'release-notes.md');
writeFileSync(stagedNotes, notes);

// ── latest.json (updater endpoint) ───────────────────────────────────────────
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-aarch64': {
      signature,
      url: `https://github.com/${REPO}/releases/download/${tag}/${tarAssetName}`,
    },
  },
};
writeFileSync(assetPaths[2], JSON.stringify(latest, null, 2));
console.log(`▶ latest.json written (signature ${signature.slice(0, 24)}…)`);

// ── Publish ─────────────────────────────────────────────────────────────────
assertGitReady(tag);
console.log(`▶ Tagging ${tag} and preparing a draft GitHub Release…`);
run('git', ['tag', tag]);
run('git', ['push', 'origin', tag]);

const releaseArgs = [
  tag,
  '--repo',
  REPO,
  '--title',
  `Wisp ${version}`,
  '--notes-file',
  stagedNotes,
];
const created = spawnSync('gh', ['release', 'create', ...releaseArgs, '--verify-tag', '--draft'], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (created.error) die(`Could not create release: ${created.error.message}`);
if (created.status !== 0) {
  // Pushing the tag also starts the release workflow, which may create the draft first.
  const existing = spawnSync('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'isDraft'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (existing.status !== 0) {
    die(
      `Could not create or inspect release: ${created.stderr.trim()} ${existing.stderr?.trim() || ''}`,
    );
  }
  if (!JSON.parse(existing.stdout).isDraft) {
    die(`Release ${tag} already exists and is published; refusing to replace its assets.`);
  }
  console.log(`▶ Reusing existing draft release ${tag}.`);
} else if (created.stdout.trim()) {
  console.log(created.stdout.trim());
}

run('gh', ['release', 'upload', tag, ...assetPaths, '--repo', REPO, '--clobber']);
run('gh', [
  'release',
  'edit',
  tag,
  '--repo',
  REPO,
  '--title',
  `Wisp ${version}`,
  '--notes-file',
  stagedNotes,
  '--draft=false',
]);

const published = JSON.parse(
  capture('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'isDraft,assets']),
);
const uploadedNames = new Set(published.assets.map((asset) => asset.name));
if (
  published.isDraft ||
  ![dmgAssetName, tarAssetName, 'latest.json'].every((name) => uploadedNames.has(name))
) {
  die(`Release ${tag} is missing required assets or is still a draft.`);
}

console.log(`✔ Released ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
console.log(
  '  Updater endpoint: https://github.com/' + REPO + '/releases/latest/download/latest.json',
);
