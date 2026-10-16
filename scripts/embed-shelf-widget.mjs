#!/usr/bin/env node
/**
 * #82/#25：收集架 appex（小组件 + 分享扩展）的打包守卫（tauri build 的 beforeBundleCommand）。
 *
 * beforeBundleCommand 在 tauri 组装 .app **之前**运行，此刻还没有 bundle 可言，
 * 所以这里只负责「保证两个 appex 已构建并暂存在 shelf-engine/」；真正把它们
 * 放进 Wisp.app/Contents/PlugIns 的，是 apps/src-tauri/tauri.macos.conf.json 里
 * bundle.macOS.files 的映射：
 *   "shelf-engine/WispShelfWidget.appex" → "PlugIns/WispShelfWidget.appex"
 *   "shelf-engine/WispShelfShare.appex"  → "PlugIns/WispShelfShare.appex"
 *
 * 正常路径下 beforeBuildCommand（shelf:prepare）已构建好 appex；这里兜底的是
 * 「stamp 命中但某个 appex 被手动删除」这类残缺状态。dev（tauri dev）没有 bundle
 * 阶段，不会走到这里；dev 的跳过说明见 prepare-shelf.mjs。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shelf = join(root, 'apps/shelf');
const staging = join(root, 'apps/src-tauri/shelf-engine');
const signingIdentity = process.env.SHELF_SIGN_IDENTITY ?? process.env.APPLE_SIGNING_IDENTITY ?? '-';
const products = join(shelf, '.build/apple/Products/Release');

if (process.platform !== 'darwin') {
  console.log('Shelf appex bundles are only bundled on macOS.');
  process.exit(0);
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const verified = (appex) =>
  spawnSync('codesign', ['--verify', '--strict', appex], { stdio: 'ignore' }).status === 0;

// 每个条目：appex 暂存路径 + 二进制名 + 组装脚本 + 传给脚本的输出路径环境变量。
const bundles = [
  { appex: join(staging, 'WispShelfWidget.appex'), binary: 'WispShelfWidget', script: 'build-widget.sh', envKey: 'SHELF_BUILD_WIDGET_APP' },
  { appex: join(staging, 'WispShelfShare.appex'), binary: 'WispShelfShare', script: 'build-share.sh', envKey: 'SHELF_BUILD_SHARE_APP' },
];

const missing = bundles.filter(({ appex, binary }) =>
  !existsSync(join(appex, `Contents/MacOS/${binary}`)) || !verified(appex));

if (missing.length === 0) {
  console.log('Shelf appex bundles are ready.');
  process.exit(0);
}

for (const { appex, script, envKey } of missing) {
  console.log(`Shelf appex missing or unsigned; rebuilding ${appex}…`);
}
// 与 prepare-shelf.mjs 同一套双架构构建，保证 appex 也是 universal。
run('swift', ['build', '-c', 'release', '--build-system', 'xcode', '--arch', 'arm64', '--arch', 'x86_64'], { cwd: shelf });
for (const { appex, script, envKey } of missing) {
  run('zsh', [script], {
    cwd: shelf,
    env: {
      ...process.env,
      SHELF_BUILD_BIN: products,
      SHELF_BUILD_CONFIGURATION: 'release',
      [envKey]: appex,
      SHELF_HOSTED_COMPONENT: '1',
      SHELF_SIGN_IDENTITY: signingIdentity,
    },
  });
  if (!verified(appex)) {
    console.error(`Shelf appex failed codesign verification: ${appex}`);
    process.exit(1);
  }
}
console.log('Shelf appex bundles are ready.');
