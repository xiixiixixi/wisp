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

// Readable source samples exercise the same preview renderers as desktop files.
const previewSamples: Record<string, string> = {
  'file-summary.ts': `// Keep folders separate from files in the workspace.
type Entry = {
  name: string;
  size: number;
  isDirectory: boolean;
};

export function summarize(entries: Entry[]) {
  const files = entries.filter(entry => !entry.isDirectory);
  const total = files.reduce((bytes, file) => bytes + file.size, 0);

  return {
    label: "最近访问",
    count: files.length,
    totalBytes: total,
    ready: true,
  };
}
`,
  'WorkspaceView.swift': `import SwiftUI

struct WorkspaceView: View {
    let folders = ["Launch", "Research"]

    var body: some View {
        List(folders, id: \\.self) { folder in
            Label(folder, systemImage: "folder")
        }
        .navigationTitle("Workspace")
    }
}
`,
  'preview-examples.md': [
    '# Preview examples',
    '',
    'Code blocks use the language written after the opening fence.',
    '',
    '## TypeScript',
    '```ts',
    '// Only keep files that can be previewed.',
    'const extensions = ["ts", "swift", "md"];',
    'export const canPreview = (type: string): boolean =>',
    '  extensions.includes(type);',
    '```',
    '',
    '## Python',
    '```py',
    'from pathlib import Path',
    '',
    'def visible_files(folder: Path):',
    '    return [p.name for p in folder.iterdir() if p.is_file()]',
    '```',
    '',
    '## Shell',
    '```sh',
    '# Show the current folder without changing any files.',
    'printf "Workspace: %s\\n" "$PWD"',
    '```',
    '',
    '## Unrecognized language',
    '```workspace-example',
    'workspace = "Launch"',
    'selection = ["brief.txt", "release-checklist.md"]',
    '```',
  ].join('\n'),
};

const previewSampleEntries = Object.entries(previewSamples).map(([name, content]) =>
  makeEntry(`${DEMO_HOME_PATH}/Documents/Research`, name, {
    is_dir: false,
    size: new TextEncoder().encode(content).length,
    modified: '2026-08-22T02:18:00Z',
    file_type: name.endsWith('.md') ? 'markdown' : 'code',
  }),
);

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
  [`${DEMO_HOME_PATH}/Documents/Research`]: [
    makeEntry(`${DEMO_HOME_PATH}/Documents/Research`, 'Q3-launch-plan.md', {
      is_dir: false,
      size: 2048,
      modified: '2026-08-20T16:15:00Z',
      file_type: 'markdown',
    }),
    ...previewSampleEntries,
    makeEntry(`${DEMO_HOME_PATH}/Documents/Research`, 'workspace.fig', {
      is_dir: false,
      size: 2484224,
      modified: '2026-08-21T09:40:00Z',
      file_type: 'file',
    }),
    makeEntry(`${DEMO_HOME_PATH}/Documents/Research`, 'server-history.log', {
      is_dir: false,
      size: 24 * 1024 * 1024,
      modified: '2026-08-21T09:40:00Z',
      file_type: 'text',
    }),
  ],
  [`${DEMO_HOME_PATH}/Downloads`]: [
    makeEntry(`${DEMO_HOME_PATH}/Downloads`, 'Q3-launch-plan.md', {
      is_dir: false,
      size: 4096,
      modified: '2026-08-18T09:40:00Z',
      file_type: 'markdown',
    }),
  ],
  [`${DEMO_HOME_PATH}/Desktop`]: [],
  [`${DEMO_HOME_PATH}/Pictures`]: [],
  [`${DEMO_HOME_PATH}/Videos`]: [],
  [`${DEMO_HOME_PATH}/Music`]: [],
};

const demoText: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(previewSamples).map(([name, content]) => [
      `${DEMO_HOME_PATH}/Documents/Research/${name}`,
      content,
    ]),
  ),
  [`${DEMO_HOME_PATH}/Documents/Research/Q3-launch-plan.md`]:
    '# Research copy\n\nResearch notes for the Q3 launch. This demo copy lives in Documents/Research.',
  [`${DEMO_HOME_PATH}/Downloads/Q3-launch-plan.md`]:
    '# Downloaded copy\n\nAn earlier Q3 launch plan. This demo copy lives in Downloads.',
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

export const getDemoSearchFiles = (query: string): FileEntry[] => {
  const needle = query.trim().toLocaleLowerCase();
  return Object.values(demoDirectories)
    .flat()
    .filter(
      (entry) => !entry.name.startsWith('.') && entry.name.toLocaleLowerCase().includes(needle),
    );
};

export const getDemoRecentFiles = (): RecentFile[] =>
  documents
    .filter((entry) => !entry.name.startsWith('.'))
    .slice(0, 8)
    .map((entry, index) => ({
      path: entry.path,
      name: entry.name,
      file_type: entry.file_type,
      accessed_at: Date.now() - (index + 1) * 23 * 60_000,
      size: entry.size,
    }));
