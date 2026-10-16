import type { TFunction } from 'i18next';

// Translate app-owned diagnostics at render time so an open error state also
// follows language changes. Unknown OS/decoder errors remain intact for support.
const PREVIEW_ERROR_KEYS: Record<string, string> = {
  'File is too large for preview': 'previewErrors.tooLarge',
  'Invalid JSON format': 'previewErrors.invalidJson',
  'Failed to load JSON file': 'previewErrors.loadJson',
  'Failed to load CSV file': 'previewErrors.loadCsv',
  'Failed to load document': 'previewErrors.loadDocument',
  'Unsupported document format': 'previewErrors.unsupportedDocument',
  'Failed to load spreadsheet': 'previewErrors.loadSpreadsheet',
  'One or both files exceed the 2 MB size limit for text comparison.':
    'previewErrors.comparisonTooLarge',
  'Failed to read file(s)': 'previewErrors.readFiles',
};

export const previewErrorText = (error: string, t: TFunction): string => {
  const key = PREVIEW_ERROR_KEYS[error];
  return key ? t(key) : error;
};
