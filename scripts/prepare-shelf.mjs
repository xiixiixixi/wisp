import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shelf = join(root, 'apps/shelf');
const staging = join(root, 'apps/src-tauri/shelf-engine');
const output = join(staging, 'WispShelf.app');
// #82：桌面小组件扩展，与 WispShelf.app 同场暂存；打包时由
// tauri.macos.conf.json 的 bundle.macOS.files 映射进主 Wisp.app 的 Contents/PlugIns。
const widgetOutput = join(staging, 'WispShelfWidget.appex');
// #25：分享扩展，与小组件同一套组装与嵌入方式（build-share.sh / PlugIns 映射）。
const shareOutput = join(staging, 'WispShelfShare.appex');
const configuration = process.argv.includes('--dev') ? 'debug' : 'release';
const signingIdentity = process.env.SHELF_SIGN_IDENTITY ?? process.env.APPLE_SIGNING_IDENTITY ?? '-';
const stamp = join(staging, '.build-stamp');

if (process.platform !== 'darwin') {
  console.log('Native shelves are only bundled on macOS.');
  process.exit(0);
}

const hash = createHash('sha256');
hash.update(`${configuration}:universal:${process.arch}:${signingIdentity}`);
const hashTree = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) hashTree(full);
    else { hash.update(full); hash.update(readFileSync(full)); }
  }
};
hashTree(join(shelf, 'Sources'));
hashTree(join(shelf, 'Resources'));
hash.update(readFileSync(join(shelf, 'Package.swift')));
hash.update(readFileSync(join(shelf, 'build.sh')));
hash.update(readFileSync(join(shelf, 'build-widget.sh')));
hash.update(readFileSync(join(shelf, 'build-share.sh')));
hash.update(readFileSync(fileURLToPath(import.meta.url)));
const digest = hash.digest('hex');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: shelf, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
};

const widgetBinaryReady = () => existsSync(join(widgetOutput, 'Contents/MacOS/WispShelfWidget'));
const shareBinaryReady = () => existsSync(join(shareOutput, 'Contents/MacOS/WispShelfShare'));
// 两个 appex（#82 小组件 / #25 分享扩展）都只在 release 打包；dev 没有 app bundle 可嵌。
const appexNeeded = configuration === 'release';

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === digest
    && existsSync(join(output, 'Contents/MacOS/WispShelf'))
    && (!appexNeeded || (widgetBinaryReady() && shareBinaryReady()))) {
  run('codesign', ['--verify', '--deep', '--strict', output]);
  console.log('Wisp native shelf component is ready.');
  process.exit(0);
}

mkdirSync(staging, { recursive: true });
run('swift', ['build', '-c', configuration, '--build-system', 'xcode', '--arch', 'arm64', '--arch', 'x86_64']);
run('zsh', ['build.sh'], { env: {
  ...process.env,
  SHELF_BUILD_BIN: join(shelf, '.build/apple/Products', configuration === 'debug' ? 'Debug' : 'Release'),
  SHELF_BUILD_CONFIGURATION: configuration,
  SHELF_BUILD_APP: output,
  SHELF_HOSTED_COMPONENT: '1',
  SHELF_SIGN_IDENTITY: signingIdentity,
} });
run('codesign', ['--verify', '--deep', '--strict', output]);
const architectures = spawnSync('lipo', ['-archs', join(output, 'Contents/MacOS/WispShelf')], { encoding: 'utf8' });
if (architectures.status !== 0 || !['arm64', 'x86_64'].every((arch) => architectures.stdout.includes(arch))) {
  throw new Error('The embedded shelf component must include both Mac architectures.');
}
if (appexNeeded) {
  // #82：release 打包时一并组装小组件 appex；dev 运行没有 app bundle，
  // 不嵌（见下方 else 分支），pnpm pi:dev 流程不受影响。
  run('zsh', ['build-widget.sh'], { env: {
    ...process.env,
    SHELF_BUILD_BIN: join(shelf, '.build/apple/Products', configuration === 'debug' ? 'Debug' : 'Release'),
    SHELF_BUILD_CONFIGURATION: configuration,
    SHELF_BUILD_WIDGET_APP: widgetOutput,
    SHELF_HOSTED_COMPONENT: '1',
    SHELF_SIGN_IDENTITY: signingIdentity,
  } });
  run('codesign', ['--verify', '--strict', widgetOutput]);
  const widgetArchitectures = spawnSync('lipo', ['-archs', join(widgetOutput, 'Contents/MacOS/WispShelfWidget')], { encoding: 'utf8' });
  if (widgetArchitectures.status !== 0 || !['arm64', 'x86_64'].every((arch) => widgetArchitectures.stdout.includes(arch))) {
    throw new Error('The shelf widget appex must include both Mac architectures.');
  }
  console.log('Shelf widget appex prepared (embedded into Wisp.app/Contents/PlugIns at bundle time).');
  // #25：分享扩展 appex 与小组件同场组装、同一套双架构校验。
  run('zsh', ['build-share.sh'], { env: {
    ...process.env,
    SHELF_BUILD_BIN: join(shelf, '.build/apple/Products', configuration === 'debug' ? 'Debug' : 'Release'),
    SHELF_BUILD_CONFIGURATION: configuration,
    SHELF_BUILD_SHARE_APP: shareOutput,
    SHELF_HOSTED_COMPONENT: '1',
    SHELF_SIGN_IDENTITY: signingIdentity,
  } });
  run('codesign', ['--verify', '--strict', shareOutput]);
  const shareArchitectures = spawnSync('lipo', ['-archs', join(shareOutput, 'Contents/MacOS/WispShelfShare')], { encoding: 'utf8' });
  if (shareArchitectures.status !== 0 || !['arm64', 'x86_64'].every((arch) => shareArchitectures.stdout.includes(arch))) {
    throw new Error('The shelf share appex must include both Mac architectures.');
  }
  console.log('Shelf share appex prepared (embedded into Wisp.app/Contents/PlugIns at bundle time).');
} else {
  console.log('Dev run: skipping the shelf appex bundles — tauri dev has no app bundle to embed them in. Release/tauri build embeds them.');
}
writeFileSync(stamp, digest);
console.log('Wisp native shelf component prepared.');
