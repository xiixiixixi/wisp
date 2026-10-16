import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, rename, readFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createShareService({ directory, token, publicURL, maxBytes = 250 * 1024 * 1024, lifetimeMs = 7 * 86400000 }) {
  if (!token || token.length < 16) throw new Error('A private upload token of at least 16 characters is required.');
  const root = resolve(directory);
  function authorized(req) {
    const provided = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
  function json(res, code, data) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  const server = createServer(async (req, res) => {
    let temporary;
    try {
      const base = publicURL || `http://127.0.0.1:${server.address().port}`;
      const url = new URL(req.url, base);
      if (req.method === 'POST' && url.pathname === '/upload') {
        if (!authorized(req)) { json(res, 401, { error: 'Unauthorized upload.' }); return; }
        if (Number(req.headers['content-length']) > maxBytes) { json(res, 413, { error: 'File too large.' }); return; }
        await mkdir(root, { recursive: true, mode: 0o700 });
        const id = randomUUID();
        temporary = join(root, `${id}.tmp`);
        const file = await open(temporary, 'wx', 0o600);
        let received = 0;
        const limit = new Transform({ transform(chunk, encoding, callback) {
          received += chunk.length;
          callback(received > maxBytes ? new Error('File too large.') : null, chunk);
        } });
        try { await pipeline(req, limit, file.createWriteStream()); } finally { await file.close(); }
        let name;
        try { name = decodeURIComponent(req.headers['x-filename'] || 'file'); } catch { name = 'file'; }
        name = name.replace(/[\0\r\n/\\]/g, '_').slice(0, 200) || 'file';
        const expiresAt = Date.now() + lifetimeMs;
        const meta = join(root, `${id}.json`);
        const metaFile = await open(`${meta}.tmp`, 'wx', 0o600);
        try { await metaFile.writeFile(JSON.stringify({ name, size: received, expiresAt })); } finally { await metaFile.close(); }
        await rename(temporary, join(root, `${id}.data`)); temporary = undefined;
        await rename(`${meta}.tmp`, meta);
        json(res, 201, { url: `${base.replace(/\/$/, '')}/f/${id}`, expiresAt }); return;
      }
      const match = url.pathname.match(/^\/f\/([0-9a-f-]{36})$/i);
      if (match && req.method === 'DELETE') {
        if (!authorized(req)) { json(res, 401, { error: 'Unauthorized revoke.' }); return; }
        await Promise.all([unlink(join(root, `${match[1]}.data`)), unlink(join(root, `${match[1]}.json`))]);
        json(res, 200, { revoked: true }); return;
      }
      if (match && req.method === 'GET') {
        const meta = JSON.parse(await readFile(join(root, `${match[1]}.json`), 'utf8'));
        if (Date.now() >= meta.expiresAt) { json(res, 410, { error: 'Expired link.' }); return; }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': meta.size,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
          'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
        await pipeline(createReadStream(join(root, `${match[1]}.data`)), res); return;
      }
      json(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (temporary) await unlink(temporary).catch(() => {});
      if (!res.headersSent && !res.destroyed) json(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'The request could not be completed.' });
      else if (!res.destroyed) res.destroy();
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createShareService({ directory: process.env.SHELF_SHARE_DIR || '.local-share-data', token: process.env.SHELF_SHARE_TOKEN, publicURL: process.env.SHELF_SHARE_PUBLIC_URL });
  server.listen(Number(process.env.PORT || 5198), '127.0.0.1', () => process.stdout.write(`Local sharing endpoint: http://127.0.0.1:${server.address().port}/upload\n`));
}
