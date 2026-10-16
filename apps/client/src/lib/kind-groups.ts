/**
 * Finder's kind-bucket table (GroupByKind.plist semantics) — the single
 * source both the F2 "group by kind" view and the #29 search chips bucket
 * with. Kept free of runtime imports so any module (or test mock surface)
 * can load it without dragging the utils bundle's graph along.
 */
import type { FileEntry } from '@/lib/tauri-api';

/** Kind view of a group; structurally assignable to utils' FileGroup. */
export interface KindFileGroup {
  group: KindGroup;
  files: FileEntry[];
}

export type KindGroup =
  | 'folders'
  | 'applications'
  | 'documents'
  | 'images'
  | 'movies'
  | 'audio'
  | 'archives'
  | 'sourceCode'
  | 'spreadsheets'
  | 'presentations'
  | 'pdf'
  | 'other';

const KIND_GROUP_I18N_KEYS: Record<KindGroup, string> = {
  folders: 'folders',
  applications: 'applications',
  documents: 'documents',
  images: 'images',
  movies: 'movies',
  audio: 'audio',
  archives: 'archives',
  sourceCode: 'sourceCode',
  spreadsheets: 'spreadsheets',
  presentations: 'presentations',
  pdf: 'pdf',
  other: 'other',
};

export const getKindGroupTranslationKey = (group: KindGroup): string =>
  `fileGrid.kindGroups.${KIND_GROUP_I18N_KEYS[group]}`;

/** Verdict order: folders → apps → documents → media → niche → other. */
const KIND_GROUP_ORDER: KindGroup[] = [
  'folders',
  'applications',
  'documents',
  'images',
  'movies',
  'audio',
  'archives',
  'sourceCode',
  'spreadsheets',
  'presentations',
  'pdf',
  'other',
];

const KIND_BY_EXTENSION: Record<string, KindGroup> = {
  // com.adobe.pdf
  pdf: 'pdf',
  // conformance to public.image
  avif: 'images',
  bmp: 'images',
  gif: 'images',
  heic: 'images',
  heif: 'images',
  ico: 'images',
  jpeg: 'images',
  jpg: 'images',
  png: 'images',
  psd: 'images',
  svg: 'images',
  tif: 'images',
  tiff: 'images',
  webp: 'images',
  // conformance to public.movie
  '3gp': 'movies',
  avi: 'movies',
  flv: 'movies',
  m4v: 'movies',
  mkv: 'movies',
  mov: 'movies',
  mp4: 'movies',
  mpeg: 'movies',
  mpg: 'movies',
  ogv: 'movies',
  webm: 'movies',
  wmv: 'movies',
  // conformance to public.audio
  aac: 'audio',
  aiff: 'audio',
  flac: 'audio',
  m4a: 'audio',
  mp3: 'audio',
  ogg: 'audio',
  opus: 'audio',
  wav: 'audio',
  wma: 'audio',
  // Finder's archive kinds ("ZIP 归档", "磁盘映像") — not in the plist
  '7z': 'archives',
  bz2: 'archives',
  cbr: 'archives',
  cbz: 'archives',
  dmg: 'archives',
  gz: 'archives',
  iso: 'archives',
  rar: 'archives',
  tar: 'archives',
  tbz: 'archives',
  tgz: 'archives',
  txz: 'archives',
  xz: 'archives',
  zip: 'archives',
  // public.source-code (+ public.html, shell scripts conform transitively)
  bash: 'sourceCode',
  c: 'sourceCode',
  cc: 'sourceCode',
  cpp: 'sourceCode',
  cs: 'sourceCode',
  css: 'sourceCode',
  dart: 'sourceCode',
  go: 'sourceCode',
  h: 'sourceCode',
  hpp: 'sourceCode',
  htm: 'sourceCode',
  html: 'sourceCode',
  java: 'sourceCode',
  js: 'sourceCode',
  jsx: 'sourceCode',
  kt: 'sourceCode',
  kts: 'sourceCode',
  lua: 'sourceCode',
  m: 'sourceCode',
  mm: 'sourceCode',
  php: 'sourceCode',
  pl: 'sourceCode',
  ps1: 'sourceCode',
  py: 'sourceCode',
  rb: 'sourceCode',
  rs: 'sourceCode',
  scala: 'sourceCode',
  sh: 'sourceCode',
  svelte: 'sourceCode',
  swift: 'sourceCode',
  ts: 'sourceCode',
  tsx: 'sourceCode',
  vue: 'sourceCode',
  zsh: 'sourceCode',
  // iWork/Office sheets (com.apple.iwork.numbers / com.microsoft.excel)
  numbers: 'spreadsheets',
  ods: 'spreadsheets',
  xls: 'spreadsheets',
  xlsm: 'spreadsheets',
  xlsx: 'spreadsheets',
  // iWork Keynote / PowerPoint (public.presentation)
  key: 'presentations',
  odp: 'presentations',
  ppt: 'presentations',
  pptx: 'presentations',
  // com.apple.application-file; application-bundle is the .app case below
  deb: 'applications',
  exe: 'applications',
  ipa: 'applications',
  msi: 'applications',
  pkg: 'applications',
  rpm: 'applications',
  // Everything else with content (public.plain-text family, iWork/Word word
  // processor documents, books) shares the 文稿 bucket; Finder also shows
  // "文稿" for extensionless files.
  csv: 'documents',
  doc: 'documents',
  docx: 'documents',
  epub: 'documents',
  json: 'documents',
  log: 'documents',
  md: 'documents',
  mobi: 'documents',
  odt: 'documents',
  pages: 'documents',
  rtf: 'documents',
  tex: 'documents',
  toml: 'documents',
  txt: 'documents',
  xml: 'documents',
  yaml: 'documents',
  yml: 'documents',
  // Binaries that are not documents under any conformance
  bin: 'other',
  class: 'other',
  dat: 'other',
  db: 'other',
  dylib: 'other',
  lock: 'other',
  o: 'other',
  obj: 'other',
  otf: 'other',
  so: 'other',
  sqlite: 'other',
  ttf: 'other',
  woff: 'other',
  woff2: 'other',
};

/** Name-only bucketing — shared by grouping and the search kind chips so a
 *  plain filename (no FileEntry metadata) buckets identically. */
export const getKindBucketByName = (isDir: boolean, name: string): KindGroup => {
  const lower = name.toLowerCase();
  // .app bundles are directories on disk but group with applications.
  if (lower.endsWith('.app')) return 'applications';
  if (isDir) return 'folders';
  const ext = lower.includes('.') ? (lower.split('.').pop() ?? '') : '';
  if (!ext) return 'documents';
  return KIND_BY_EXTENSION[ext] ?? 'documents';
};

export const getFileKindBucket = (file: FileEntry): KindGroup =>
  getKindBucketByName(file.is_dir, file.name);

export const groupFilesByKind = (files: FileEntry[]): KindFileGroup[] => {
  const groups = new Map<KindGroup, FileEntry[]>();
  for (const group of KIND_GROUP_ORDER) groups.set(group, []);
  // Insertion keeps the caller's active sort intact inside every group.
  for (const file of files) {
    groups.get(getFileKindBucket(file))?.push(file);
  }
  return KIND_GROUP_ORDER.filter((group) => (groups.get(group) ?? []).length > 0).map((group) => ({
    group,
    files: groups.get(group) ?? [],
  }));
};
