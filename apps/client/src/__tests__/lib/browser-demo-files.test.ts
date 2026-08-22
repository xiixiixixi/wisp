import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
}));
import {
  buildDirectoryContext,
  readFileForAIContext,
} from '@/components/panels/chat-context-helpers';
import { buildDirectorySummary } from '@/components/panels/chat-workspace-awareness';
import {
  DEMO_HOME_PATH,
  getDemoDirectory,
  getDemoRecentFiles,
  getDemoTextFile,
  getDemoUserDirectories,
} from '@/lib/browser-demo-files';

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('browser demo files', () => {
  it('provides a realistic document workspace without sharing mutable entries', () => {
    const path = `${DEMO_HOME_PATH}/Documents`;
    const firstRead = getDemoDirectory(path);
    const secondRead = getDemoDirectory(path);

    expect(firstRead).toHaveLength(6);
    expect(firstRead?.some((entry) => entry.is_dir)).toBe(true);
    expect(firstRead?.some((entry) => entry.name === 'Q3-launch-plan.md')).toBe(true);
    expect(firstRead?.[0]).not.toBe(secondRead?.[0]);
  });

  it('keeps quick access, recent files, and preview content aligned', () => {
    const directories = getDemoUserDirectories();
    const recent = getDemoRecentFiles();

    expect(directories.documents).toBe(`${DEMO_HOME_PATH}/Documents`);
    expect(recent[0]?.path.startsWith(directories.documents)).toBe(true);
    expect(recent[0]?.accessed_at).toBeGreaterThan(1_000_000_000_000);
    expect(getDemoTextFile(`${directories.documents}/Q3-launch-plan.md`)).toContain(
      'Q3 launch plan',
    );
    expect(getDemoTextFile(`${directories.documents}/Brand-guidelines.pdf`)).toBeNull();
  });

  it('keeps AI directory and file context aligned with the demo workspace', async () => {
    window.history.replaceState({}, '', '/?demo=1');
    const documentsPath = `${DEMO_HOME_PATH}/Documents`;
    const planPath = `${documentsPath}/Q3-launch-plan.md`;

    const [summary, directoryContext, fileContext] = await Promise.all([
      buildDirectorySummary(documentsPath),
      buildDirectoryContext(documentsPath),
      readFileForAIContext({ name: 'Q3-launch-plan.md', path: planPath, is_dir: false }),
    ]);

    expect(summary).toMatchObject({ totalItems: 6, dirCount: 2, fileCount: 4 });
    expect(directoryContext).toContain('Directory listing');
    expect(directoryContext).toContain('Q3-launch-plan.md');
    expect(fileContext.content).toContain('Ship the new Wisp workspace experience');
  });
});
