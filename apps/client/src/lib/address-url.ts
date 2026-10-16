// In a file manager, ambiguous document names should remain file paths.
// An explicit http(s) URL always takes precedence over this heuristic.
const FILE_SUFFIXES = new Set([
  'md',
  'txt',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'csv',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'log',
  'zip',
  'tar',
  'gz',
  '7z',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'heic',
  'mp4',
  'mov',
  'mp3',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'html',
  'go',
  'swift',
  'dmg',
  'exe',
  'dll',
  'lock',
  'env',
]);

/** Return a normalized web destination, or null to retain path navigation. */
export const addressToWebUrl = (input: string): string | null => {
  const value = input.trim();
  if (
    !value ||
    value.includes('\\') ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    return null;
  }
  const explicit = /^https?:\/\//i.test(value);
  if (!explicit && (/^[/.~]/.test(value) || /^[a-z]:/i.test(value))) return null;

  try {
    const url = new URL(explicit ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    if (explicit) return url.href;
    // No implicit credentials/email addresses or non-web schemes.
    if (url.username || url.password || value.includes('://')) return null;
    const host = url.hostname;
    const local =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '[::1]' ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(host) || /^\[[0-9a-f:]+\]$/i.test(host);
    const labels = host.split('.');
    const domain =
      labels.length >= 2 &&
      labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) &&
      /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/i.test(labels.at(-1)!);
    if (!local && !ip && !domain) return null;
    if (!local && !ip && FILE_SUFFIXES.has(labels.at(-1)!)) return null;
    // WHATWG URL accepts shorthand/octal numeric hosts. Require a full,
    // unambiguous address when the protocol is omitted.
    const authority = value.split(/[/?#]/, 1)[0];
    if (
      ip &&
      !authority.startsWith('[') &&
      (!/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(authority) || authority.split(':')[0] !== host)
    ) {
      return null;
    }
    if (local) url.protocol = 'http:';
    return url.href;
  } catch {
    return null;
  }
};
