import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

function argument(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} 需要参数。`);
  return args[index + 1];
}

function dimensions(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data[0] !== 255 || data[1] !== 216) throw new Error('无法识别图片尺寸；请提供常规截图图片。');
  const frameMarkers = new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
  let offset = 2;
  while (offset + 3 < data.length) {
    while (data[offset] === 255) offset++;
    const marker = data[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 216)) continue;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if (frameMarkers.has(marker) && length >= 7) return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
    offset += length;
  }
  throw new Error('无法读取图片尺寸；请检查截图文件是否完整。');
}

function validWidth(value) { return Number.isInteger(value) && value >= 600 && value <= 6000; }
function validPadding(value) { return typeof value === 'number' && value >= .01 && value <= .08; }

async function readConfig(configPath, sourceOverride) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.outputWidth ??= 1600;
  config.paddingRatio ??= .022;
  if (!Array.isArray(config.screenshots) || !config.screenshots.length) throw new Error('配置需要至少一个截图位置。');
  if (!validWidth(config.outputWidth)) throw new Error('成图宽度需要在 600 到 6000 像素之间。');
  if (!validPadding(config.paddingRatio)) throw new Error('截图外围留白比例需要在 0.01 到 0.08 之间。');
  const sourceDirectory = sourceOverride ? resolve(sourceOverride) : resolve(dirname(configPath), config.sourceDirectory || '.');
  const ids = new Set();
  for (const shot of config.screenshots) {
    if (!/^[a-z0-9-]+$/.test(shot.id) || ids.has(shot.id)) throw new Error('截图标识需唯一，并只含小写英文字母、数字或短横线。');
    ids.add(shot.id);
    if (shot.outputWidth !== undefined && !validWidth(shot.outputWidth)) throw new Error(`${shot.id} 的成图宽度无效。`);
    if (shot.paddingRatio !== undefined && !validPadding(shot.paddingRatio)) throw new Error(`${shot.id} 的留白比例无效。`);
    if (shot.crop && (!['x', 'y', 'width', 'height'].every(key => Number.isInteger(shot.crop[key])) || shot.crop.x < 0 || shot.crop.y < 0 || shot.crop.width <= 0 || shot.crop.height <= 0)) throw new Error(`${shot.id} 的裁切坐标必须是原图像素的有效整数。`);
    if (shot.path) {
      shot.path = resolve(sourceDirectory, shot.path);
      if (!types[extname(shot.path).toLowerCase()]) throw new Error('请使用截图的 PNG（无损图片）或 JPEG（照片图片）格式。');
      let info;
      try { info = await stat(shot.path); } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`未找到截图：${shot.path}\n调试时可用 --source-dir 指向实际截图目录。`);
        throw error;
      }
      if (!info.isFile()) throw new Error(`截图路径不是文件：${shot.path}`);
      shot.size = dimensions(await readFile(shot.path));
      if (shot.crop && (shot.crop.x + shot.crop.width > shot.size.width || shot.crop.y + shot.crop.height > shot.size.height)) throw new Error(`${shot.id} 的裁切超出原图 ${shot.size.width} × ${shot.size.height} 范围。`);
    }
  }
  return config;
}

try {
  if (args.includes('--help')) {
    process.stdout.write(`用法：node scripts/readme-screenshots/server.mjs [--check] [--port 5188] [--config 配置文件] [--source-dir 原始截图目录]\n配置默认指向 images/readme/source/。\n成图入口：/capture/截图标识/slate\n只在本机预览，不生成图片。\n`);
  } else {
    const configPath = resolve(argument('--config', resolve(here, 'screenshots.json')));
    const sourceOverride = argument('--source-dir', null);
    const initialConfig = await readConfig(configPath, sourceOverride);
    if (args.includes('--check')) {
      for (const shot of initialConfig.screenshots.filter(item => item.path)) process.stdout.write(`${shot.id}：原图 ${shot.size.width} × ${shot.size.height}，裁切 ${shot.crop ? `${shot.crop.width} × ${shot.crop.height}` : '完整原图'}，配置有效。\n`);
    } else {
      const port = Number(argument('--port', initialConfig.port ?? 5187));
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口无效。');
      const server = http.createServer(async (request, response) => {
        try {
          const url = new URL(request.url, 'http://127.0.0.1');
          response.setHeader('Cache-Control', 'no-store');
          const config = await readConfig(configPath, sourceOverride);
          const captureMatch = url.pathname.match(/^\/capture\/([a-z0-9-]+)\/slate$/);
          if (url.pathname === '/' || url.pathname === '/index.html' || captureMatch) {
            if (captureMatch && !config.screenshots.some(shot => shot.id === captureMatch[1] && shot.path)) {
              response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('此截图尚未配置。'); return;
            }
            if (url.searchParams.has('width') && !validWidth(Number(url.searchParams.get('width')))) {
              response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('成图宽度需要在 600 到 6000 像素之间。'); return;
            }
            const template = await readFile(resolve(here, 'index.html'), 'utf8');
            const safeConfig = JSON.stringify(config).replaceAll('<', '\\u003c');
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(template.replace('__CONFIG__', safeConfig)); return;
          }
          const mediaMatch = url.pathname.match(/^\/media\/([a-z0-9-]+)$/);
          if (mediaMatch) {
            const shot = config.screenshots.find(item => item.id === mediaMatch[1] && item.path);
            if (shot) {
              const image = await readFile(shot.path);
              response.writeHead(200, { 'Content-Type': types[extname(shot.path).toLowerCase()] }); response.end(image); return;
            }
          }
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('未找到页面或截图。');
        } catch (error) {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(error.message);
        }
      });
      server.on('error', error => {
        process.stderr.write(error.code === 'EADDRINUSE' ? `端口 ${port} 已被使用，请指定其他端口。\n` : error.message + '\n'); process.exitCode = 1;
      });
      server.listen(port, '127.0.0.1', () => process.stdout.write(`预览页：http://127.0.0.1:${server.address().port}/\n进程编号：${process.pid}\n配置：${configPath}\n`));
    }
  }
} catch (error) {
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
}
