import { buildDestinationPath } from '@/lib/drag-utils';

export type BrowserDropPlan =
  | { kind: 'url'; content: string }
  | { kind: 'text'; content: string }
  | { kind: 'image'; bytes: number[]; ext: string }
  | null;

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** macOS .webloc bookmark (Finder "location" file) for a URL. */
export const buildWeblocXml = (url: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
  `<plist version="1.0">\n<dict>\n\t<key>URL</key>\n\t<string>${escapeXml(url)}</string>\n</dict>\n</plist>\n`;

/** Timestamped destination name so repeated drops never collide. */
export const uniqueDroppedName = (targetDir: string, base: string, ext: string): string =>
  buildDestinationPath(`${base}-${Date.now()}.${ext}`, targetDir);

const imageExt = (mimeType: string): string => {
  const ext = mimeType.split('/')[1] ?? 'png';
  return ext === 'jpeg' ? 'jpg' : ext;
};

/**
 * Parse an HTML5 drop event's data for non-file content (text, URL, image
 * blob). Real filesystem drags are consumed by Tauri's native drop handler
 * and never reach the HTML5 layer, so any File present here is a blob.
 */
export const parseBrowserDrop = async (dataTransfer: DataTransfer): Promise<BrowserDropPlan> => {
  const uriList = dataTransfer.getData('text/uri-list').trim();
  if (uriList) {
    const url = uriList.split(/[\r\n]+/)[0].trim();
    if (url) return { kind: 'url', content: buildWeblocXml(url) };
  }

  const text = (
    dataTransfer.getData('text/plain') || dataTransfer.getData('public.utf8-plain-text')
  ).trim();
  if (text) return { kind: 'text', content: text };

  const file = dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    return { kind: 'image', bytes: Array.from(buffer), ext: imageExt(file.type) };
  }

  return null;
};
