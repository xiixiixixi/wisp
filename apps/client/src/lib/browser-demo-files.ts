import type { FileEntry, RecentFile } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';

export const DEMO_HOME_PATH = '/home/user';

const modifiedAt = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const makeEntry = (
  parent: string,
  name: string,
  options: Pick<FileEntry, 'is_dir' | 'size' | 'file_type'> & { modified: string },
): FileEntry => ({
  name,
  path: `${parent}/${name}`,
  is_dir: options.is_dir,
  size: options.size,
  modified: modifiedAt(options.modified),
  file_type: options.file_type,
  is_readonly: false,
});

const documents = [
  makeEntry(`${DEMO_HOME_PATH}/Documents`, 'Launch', {
    is_dir: true,
    size: 0,
    modified: '2026-08-21T09:40:00Z',
    file_type: 'folder',
  }),
  makeEntry(`${DEMO_HOME_PATH}/Documents`, 'Research', {
    is_dir: true,
    size: 0,
    modified: '2026-08-20T16:15:00Z',
    file_type: 'folder',
  }),
  makeEntry(`${DEMO_HOME_PATH}/Documents`, 'Q3-launch-plan.md', {
    is_dir: false,
    size: 18432,
    modified: '2026-08-22T02:18:00Z',
    file_type: 'markdown',
  }),
  makeEntry(`${DEMO_HOME_PATH}/Documents`, 'Customer-insights.txt', {
    is_dir: false,
    size: 9728,
    modified: '2026-08-21T14:32:00Z',
    file_type: 'text',
  }),
  makeEntry(`${DEMO_HOME_PATH}/Documents`, '设计方案.docx', {
    is_dir: false,
    size: 142336,
    modified: '2026-08-20T11:05:00Z',
    file_type: 'document',
  }),
  makeEntry(`${DEMO_HOME_PATH}/Documents`, '路演-keynote.pptx', {
    is_dir: false,
    size: 5128448,
    modified: '2026-08-18T09:40:00Z',
    file_type: 'presentation',
  }),
  makeEntry(`${DEMO_HOME_PATH}/Documents`, 'Budget-forecast.xlsx', {
    is_dir: false,
    size: 284672,
    modified: '2026-08-19T08:10:00Z',
    file_type: 'spreadsheet',
  }),
  makeEntry(`${DEMO_HOME_PATH}/Documents`, 'Brand-guidelines.pdf', {
    is_dir: false,
    size: 3842048,
    modified: '2026-08-18T11:05:00Z',
    file_type: 'pdf',
  }),
  // Hidden file so ⇧⌘. (toggle hidden files) is verifiable in the demo
  makeEntry(`${DEMO_HOME_PATH}/Documents`, '.secret-notes.md', {
    is_dir: false,
    size: 512,
    modified: '2026-08-17T10:00:00Z',
    file_type: 'markdown',
  }),
];

const launch = [
  makeEntry(`${DEMO_HOME_PATH}/Documents/Launch`, 'release-checklist.md', {
    is_dir: false,
    size: 6144,
    modified: '2026-08-22T01:04:00Z',
    file_type: 'markdown',
  }),
  makeEntry(`${DEMO_HOME_PATH}/Documents/Launch`, 'campaign-brief.txt', {
    is_dir: false,
    size: 12288,
    modified: '2026-08-21T04:21:00Z',
    file_type: 'text',
  }),
];

const homeRoot = ['Documents', 'Downloads', 'Desktop', 'Pictures', 'Videos', 'Music'].map((name) =>
  makeEntry(DEMO_HOME_PATH, name, {
    is_dir: true,
    size: 0,
    modified: '2026-08-21T09:40:00Z',
    file_type: 'folder',
  }),
);

const demoDirectories: Record<string, FileEntry[]> = {
  [DEMO_HOME_PATH]: homeRoot,
  [`${DEMO_HOME_PATH}/Documents`]: documents,
  [`${DEMO_HOME_PATH}/Documents/Launch`]: launch,
  [`${DEMO_HOME_PATH}/Documents/Research`]: [],
  [`${DEMO_HOME_PATH}/Downloads`]: [],
  [`${DEMO_HOME_PATH}/Desktop`]: [],
  [`${DEMO_HOME_PATH}/Pictures`]: [],
  [`${DEMO_HOME_PATH}/Videos`]: [],
  [`${DEMO_HOME_PATH}/Music`]: [],
};

const demoText: Record<string, string> = {
  [`${DEMO_HOME_PATH}/Documents/Q3-launch-plan.md`]: `# Q3 launch plan

## Outcome
Ship the new Wisp workspace experience with a clearer file-to-action flow.

## This week
- Validate the navigation and preview experience
- Tighten selection and batch actions
- Prepare the release checklist

## Success signal
People can find, understand, and act on a file without losing context.`,
  [`${DEMO_HOME_PATH}/Documents/Customer-insights.txt`]: `Customer insight summary

1. People want a preview before opening a file.
2. Batch actions should appear only after selection.
3. Undo needs to stay visible after destructive actions.
4. Search and AI should preserve the current folder as context.`,
  [`${DEMO_HOME_PATH}/Documents/Launch/release-checklist.md`]: `# Release checklist

- Navigation works from every entry point
- Selection actions are keyboard accessible
- Preview keeps the current directory visible
- Delete and move operations offer recovery`,
  [`${DEMO_HOME_PATH}/Documents/Launch/campaign-brief.txt`]: `Campaign brief

Position Wisp as the calm, intelligent workspace for people who work across many files.`,
};

export const isBrowserDemoMode = (): boolean => {
  if (typeof window === 'undefined' || isTauri() || !import.meta.env.DEV) return false;
  return new URLSearchParams(window.location.search).get('demo') === '1';
};

export const getDemoUserDirectories = () => ({
  home: DEMO_HOME_PATH,
  documents: `${DEMO_HOME_PATH}/Documents`,
  downloads: `${DEMO_HOME_PATH}/Downloads`,
  desktop: `${DEMO_HOME_PATH}/Desktop`,
  pictures: `${DEMO_HOME_PATH}/Pictures`,
  videos: `${DEMO_HOME_PATH}/Videos`,
  music: `${DEMO_HOME_PATH}/Music`,
});

export const getDemoDirectory = (path: string): FileEntry[] | null => {
  const entries = demoDirectories[path];
  return entries ? entries.map((entry) => ({ ...entry })) : null;
};

export const getDemoTextFile = (path: string): string | null => demoText[path] ?? null;

export const getDemoRecentFiles = (): RecentFile[] =>
  documents
    .filter((entry) => !entry.is_dir)
    .slice(0, 4)
    .map((entry) => ({
      path: entry.path,
      name: entry.name,
      file_type: entry.file_type,
      accessed_at: entry.modified * 1000,
      size: entry.size,
    }));
