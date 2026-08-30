// Keep the pdf.js worker in the client public dir in sync with the
// installed pdfjs-dist (legacy build — see vite.config.ts for why).
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const dest = join(root, 'apps/client/public/pdf.worker.min.mjs');
copyFileSync(src, dest);
console.log('[sync-pdf-worker] copied legacy worker to apps/client/public/');
