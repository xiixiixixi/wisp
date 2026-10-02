import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  VERSION,
  assetForTarget,
  installVerifiedArchive,
  resolveTarget,
  sha256File,
} from './prepare-tunnel-client.mjs';

test('uses reviewed release assets for the six supported architecture targets', () => {
  for (const [target, platform] of [
    ['aarch64-apple-darwin', 'darwin-arm64'],
    ['x86_64-apple-darwin', 'darwin-amd64'],
    ['x86_64-unknown-linux-gnu', 'linux-amd64'],
    ['aarch64-unknown-linux-gnu', 'linux-arm64'],
    ['x86_64-pc-windows-msvc', 'windows-amd64'],
    ['aarch64-pc-windows-msvc', 'windows-arm64'],
  ]) {
    const asset = assetForTarget(target);
    assert.equal(asset.platformArch, platform);
    assert.equal(asset.executableSuffix, platform.startsWith('windows') ? '.exe' : '');
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
  assert.throws(() => assetForTarget('i686-pc-windows-msvc'), /No reviewed/);
  assert.throws(() => assetForTarget('x86_64-unknown-linux-musl'), /No reviewed/);
});

test('uses the requested Tauri architecture instead of the build machine architecture', () => {
  assert.equal(
    resolveTarget([], { TAURI_ENV_TARGET_TRIPLE: 'x86_64-apple-darwin' }),
    'x86_64-apple-darwin',
  );
  assert.equal(
    resolveTarget(['--target', 'x86_64-pc-windows-msvc'], {
      TAURI_ENV_TARGET_TRIPLE: 'aarch64-apple-darwin',
    }),
    'x86_64-pc-windows-msvc',
  );
  assert.throws(() => resolveTarget(['--target']), /Usage/);
});

async function fixture(t, target = 'aarch64-apple-darwin') {
  const root = await mkdtemp(join(tmpdir(), 'wisp-tunnel-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archivePath = join(root, 'release.zip');
  await writeFile(archivePath, 'verified-test-archive');
  const asset = { ...assetForTarget(target), sha256: await sha256File(archivePath) };
  const extract = async (_archive, stage) => {
    const suffix = asset.executableSuffix;
    const contents = {
      [`tunnel-client${suffix}`]: 'official-client-fixture',
      [`cloudflared${suffix}`]: 'official-companion-fixture',
      'cloudflared-manifest.json': JSON.stringify({
        version: '2026.8.2',
        platforms: [asset.platformArch.replace('-', '/')],
      }),
      LICENSE: 'upstream-license',
      NOTICE: 'upstream-notice',
      [`tunnel-client-v${VERSION}-${asset.platformArch}-licenses.txt`]: 'dependency-licenses',
      [`tunnel-client-v${VERSION}-${asset.platformArch}.spdx.json`]: '{}',
    };
    for (const [name, content] of Object.entries(contents)) {
      await writeFile(join(stage, name), content);
    }
  };
  return { root, archivePath, asset, extract, tauriDir: join(root, 'app') };
}

test('rejects an altered archive before extracting or writing packaged executables', async (t) => {
  const options = await fixture(t);
  await writeFile(options.archivePath, 'altered-download');
  let extracted = false;
  await assert.rejects(
    installVerifiedArchive({
      ...options,
      extract: async () => {
        extracted = true;
      },
    }),
    /Checksum mismatch/,
  );
  assert.equal(extracted, false);
  await assert.rejects(stat(options.tauriDir), { code: 'ENOENT' });
});

test('packages companion, provenance, licenses and restores changed output from verified cache', async (t) => {
  const options = await fixture(t);
  await installVerifiedArchive(options);
  const client = join(options.tauriDir, `binaries/tunnel-client-${options.asset.target}`);
  assert.equal(await readFile(client, 'utf8'), 'official-client-fixture');
  if (process.platform !== 'win32') assert.equal((await stat(client)).mode & 0o777, 0o755);
  assert.equal(
    await readFile(join(options.tauriDir, 'bridge-runtime/licenses/NOTICE'), 'utf8'),
    'upstream-notice',
  );
  const source = JSON.parse(await readFile(join(options.tauriDir, 'bridge-runtime/source.json')));
  assert.equal(source.archiveSha256, options.asset.sha256);
  assert.equal(Object.keys(source.files).length, 7);
  await writeFile(client, 'changed-output');
  await installVerifiedArchive(options);
  assert.equal(await readFile(client, 'utf8'), 'official-client-fixture');
});

test('keeps Windows executable suffixes and fails on missing required companion', async (t) => {
  const options = await fixture(t, 'x86_64-pc-windows-msvc');
  await installVerifiedArchive(options);
  assert.equal(
    await readFile(
      join(options.tauriDir, 'binaries/cloudflared-x86_64-pc-windows-msvc.exe'),
      'utf8',
    ),
    'official-companion-fixture',
  );
  const incomplete = await fixture(t);
  await assert.rejects(
    installVerifiedArchive({
      ...incomplete,
      extract: async (_archive, stage) => {
        await mkdir(stage, { recursive: true });
        await writeFile(join(stage, 'tunnel-client'), 'only-client');
      },
    }),
    { code: 'ENOENT' },
  );
  await assert.rejects(stat(incomplete.tauriDir), { code: 'ENOENT' });
});
