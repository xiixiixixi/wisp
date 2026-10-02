import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = '0.0.15';
export const RELEASE_URL = `https://github.com/openai/tunnel-client/releases/tag/v${VERSION}`;
const DOWNLOAD_ROOT = `https://github.com/openai/tunnel-client/releases/download/v${VERSION}`;

// Pinned from this release's SHA256SUMS.txt, also matched to GitHub asset digests.
export const RELEASE_ASSETS = {
  'darwin-amd64': '9dcae1e2fb121287e73271edb7b853dda52aa86b7bfca1df91bc275371261bdb',
  'darwin-arm64': 'b2cae3aa9df45b4c2fe9b1d700ebacce39f9feb6a6b46b86e6499f9a51bf72ff',
  'linux-amd64': '8c836dc5d68d68b663d9a5c5b28ff9fa780d9f7a3fffb1c306880b8f32fab5f1',
  'linux-arm64': 'c51bfd883fc22e3445494a03c0179875176564bde470661b308fd83af5d01abb',
  'windows-amd64': '3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1',
  'windows-arm64': '571e0d59ed9e86d1b105dc34f3267865f654de6968b01efd7c847f0af657d11d',
};

export function assetForTarget(target) {
  const match = /^(aarch64|x86_64)-(apple-darwin|unknown-linux-gnu|pc-windows-msvc)$/.exec(target);
  if (!match) throw new Error(`No reviewed tunnel-client package for target ${target}`);
  const arch = match[1] === 'aarch64' ? 'arm64' : 'amd64';
  const platform = {
    'apple-darwin': 'darwin',
    'unknown-linux-gnu': 'linux',
    'pc-windows-msvc': 'windows',
  }[match[2]];
  const platformArch = `${platform}-${arch}`;
  const name = `tunnel-client-v${VERSION}-${platformArch}.zip`;
  return {
    target,
    name,
    platformArch,
    sha256: RELEASE_ASSETS[platformArch],
    url: `${DOWNLOAD_ROOT}/${name}`,
    executableSuffix: platform === 'windows' ? '.exe' : '',
  };
}

export function resolveTarget(args = process.argv.slice(2), env = process.env) {
  if (args.length && (args.length !== 2 || args[0] !== '--target')) {
    throw new Error('Usage: node scripts/prepare-tunnel-client.mjs [--target <Rust target>]');
  }
  const target = args[1] || env.TAURI_ENV_TARGET_TRIPLE || env.WISP_TUNNEL_TARGET;
  if (target) return target;
  const compiler = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = /^host: (.+)$/m.exec(compiler)?.[1];
  if (!host) throw new Error('Cannot determine the Rust host target');
  return host;
}

export async function sha256File(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

export async function verifyArchive(path, expected) {
  const actual = await sha256File(path);
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${path}: expected ${expected}, received ${actual}`);
  }
}

async function downloadFile(url, path) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: 'wx' }));
}

export async function extractArchive(archivePath, destination) {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:WISP_TUNNEL_ARCHIVE -DestinationPath $env:WISP_TUNNEL_EXTRACT -Force',
      ],
      {
        env: {
          ...process.env,
          WISP_TUNNEL_ARCHIVE: archivePath,
          WISP_TUNNEL_EXTRACT: destination,
        },
        stdio: 'pipe',
      },
    );
  } else {
    execFileSync('unzip', ['-q', archivePath, '-d', destination], { stdio: 'pipe' });
  }
}

async function regularFile(path) {
  if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular release file: ${path}`);
}

function outputFiles(asset) {
  const suffix = asset.executableSuffix;
  return [
    [`tunnel-client${suffix}`, `binaries/tunnel-client-${asset.target}${suffix}`, true],
    [`cloudflared${suffix}`, `binaries/cloudflared-${asset.target}${suffix}`, true],
    ['cloudflared-manifest.json', 'bridge-runtime/cloudflared-manifest.json'],
    ['LICENSE', 'bridge-runtime/licenses/LICENSE'],
    ['NOTICE', 'bridge-runtime/licenses/NOTICE'],
    [
      `tunnel-client-v${VERSION}-${asset.platformArch}-licenses.txt`,
      'bridge-runtime/licenses/third-party-licenses.txt',
    ],
    [
      `tunnel-client-v${VERSION}-${asset.platformArch}.spdx.json`,
      'bridge-runtime/licenses/dependencies.spdx.json',
    ],
  ];
}

// Every invocation rechecks the cached archive. Changed/missing outputs are
// restored from that verified archive, never from the user's Homebrew install.
export async function installVerifiedArchive({
  archivePath,
  asset,
  tauriDir,
  extract = extractArchive,
}) {
  await verifyArchive(archivePath, asset.sha256);
  const stage = await mkdtemp(join(dirname(archivePath), 'extract-'));
  try {
    await extract(archivePath, stage);
    const files = outputFiles(asset);
    for (const [source] of files) await regularFile(join(stage, source));
    const manifest = JSON.parse(await readFile(join(stage, 'cloudflared-manifest.json'), 'utf8'));
    if (!manifest.version || !manifest.platforms?.includes(asset.platformArch.replace('-', '/'))) {
      throw new Error(`Companion manifest does not support ${asset.platformArch}`);
    }
    const outputHashes = {};
    for (const [source, destination, executable] of files) {
      const output = join(tauriDir, destination);
      const expected = await sha256File(join(stage, source));
      outputHashes[destination] = expected;
      let matches = false;
      try {
        await regularFile(output);
        matches = (await sha256File(output)) === expected;
      } catch {
        // Absent or changed generated outputs are replaced below.
      }
      if (!matches) {
        await mkdir(dirname(output), { recursive: true });
        await rm(output, { force: true });
        await copyFile(join(stage, source), output);
      }
      if (executable && process.platform !== 'win32') await chmod(output, 0o755);
    }
    const provenance = {
      version: VERSION,
      target: asset.target,
      release: RELEASE_URL,
      archive: asset.name,
      archiveSha256: asset.sha256,
      cloudflaredVersion: manifest.version,
      files: outputHashes,
    };
    await writeFile(
      join(tauriDir, 'bridge-runtime/source.json'),
      `${JSON.stringify(provenance, null, 2)}\n`,
    );
    return provenance;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function prepareTunnelClient({
  target,
  root = ROOT,
  download = downloadFile,
  log = console.log,
} = {}) {
  const asset = assetForTarget(target ?? resolveTarget());
  const cache = join(root, '.local-artifacts/tunnel-client', VERSION);
  const archivePath = join(cache, asset.name);
  await mkdir(cache, { recursive: true });
  let cached = false;
  try {
    await regularFile(archivePath);
    await verifyArchive(archivePath, asset.sha256);
    cached = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!cached) {
    log(`Downloading official tunnel-client ${VERSION} (${asset.platformArch})...`);
    const downloadDir = await mkdtemp(join(cache, 'download-'));
    const partial = join(downloadDir, asset.name);
    try {
      await download(asset.url, partial);
      await verifyArchive(partial, asset.sha256);
      await rename(partial, archivePath);
    } finally {
      await rm(downloadDir, { recursive: true, force: true });
    }
  }
  const result = await installVerifiedArchive({
    archivePath,
    asset,
    tauriDir: join(root, 'apps/src-tauri'),
  });
  log(
    `Bundled connection tools ready: tunnel-client ${VERSION}, cloudflared ${result.cloudflaredVersion} (${asset.target}).`,
  );
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareTunnelClient({ target: resolveTarget() }).catch((error) => {
    console.error(`Preparing bundled connection tools failed: ${error.message}`);
    process.exitCode = 1;
  });
}
