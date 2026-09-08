import type { TFunction } from 'i18next';

// Native file metadata and browser fixtures differ in capitalization. Never
// expose an internal type identifier just because it arrived in lowercase.
const FILE_TYPE_KEYS: Record<string, string> = {
  file: 'fileType.File',
  image: 'fileType.Image',
  video: 'fileType.Video',
  audio: 'fileType.Audio',
  archive: 'fileType.Archive',
  document: 'fileType.Document',
  pdf: 'fileType.Pdf',
  spreadsheet: 'fileType.Spreadsheet',
  markdown: 'fileType.Markdown',
  text: 'fileType.Text',
  keynote: 'fileType.Keynote',
  word: 'fileType.Word',
  presentation: 'fileType.Presentation',
  folder: 'common.folder',
  directory: 'common.folder',
};

export const fileTypeLabel = (type: string, t: TFunction): string => {
  const key = FILE_TYPE_KEYS[type.toLowerCase()];
  return key ? t(key) : type;
};
