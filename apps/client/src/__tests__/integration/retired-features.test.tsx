import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePerformanceStats } from '@/hooks/use-performance-stats';
import { useDialogs } from '@/hooks/use-dialogs';
import { migrateRetiredSettings } from '@/lib/retired-settings';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const mocks = vi.hoisted(() => ({
  getTrashItems: vi.fn(),
  getFileTagsBatch: vi.fn(),
}));
vi.mock('@/lib/tauri-api', () => ({ TauriAPI: mocks }));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const files = [
  {
    name: 'large.txt',
    path: '/test/large.txt',
    size: 200 * 1024 * 1024,
    is_dir: false,
    modified: 0,
    file_type: 'text',
  },
];

describe('retired feature contracts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getTrashItems.mockResolvedValue([]);
    mocks.getFileTagsBatch.mockResolvedValue({ '/test/large.txt': ['kept'] });
  });

  it('does not ship versioning or file-audit implementations', () => {
    for (const path of [
      'apps/src-tauri/src/file_versions.rs',
      'apps/src-tauri/src/audit_log.rs',
      'packages/sdk/src/services/versions.ts',
      'packages/sdk/src/services/audit.ts',
      'apps/client/src/components/settings/VersioningSettings.tsx',
      'apps/client/src/components/settings/BackupRestoreSettings.tsx',
      'apps/client/src/components/settings/AuditLogSettings.tsx',
      'apps/client/src/components/dialogs/VersionHistoryDialog.tsx',
    ]) {
      expect(existsSync(resolve(root, path))).toBe(false);
    }
    expect(read('apps/src-tauri/src/main.rs')).not.toMatch(/file_versions::|audit_log::/);
    expect(read('apps/src-tauri/src/lib.rs')).not.toMatch(/mod (file_versions|audit_log);/);
    expect(read('packages/sdk/src/index.ts')).not.toMatch(/services\/(audit|versions)/);
    expect(read('apps/client/src/lib/extension-api-factory.ts')).not.toContain('versions: {');
  });

  it('removes the API wrappers and file-menu entry', () => {
    expect(read('apps/client/src/lib/tauri-api/system.ts')).not.toMatch(
      /get_audit_log|clear_audit_log|export_audit_log|create_version|restore_version|list_versions|enable_versioning/,
    );
    expect(read('apps/client/src/lib/context-menu-factory.ts')).not.toContain('version-history');
    expect(read('apps/client/src/lib/context-menu-rules.ts')).not.toContain('version-history');
    const { result } = renderHook(() => useDialogs());
    expect(Object.keys(result.current).some((key) => /versionHistory/i.test(key))).toBe(false);
  });

  it('keeps normal file operations and undo while removing their audit writes', () => {
    for (const path of ['copy_move.rs', 'delete.rs', 'write.rs']) {
      const source = read(`apps/src-tauri/src/operations/file_ops/${path}`);
      expect(source).not.toMatch(/audit_log|log_operation/);
    }
    const source = read('apps/src-tauri/src/operations/file_ops/copy_move.rs');
    expect(source).toContain('record_operation(FileOperation::Copy');
    expect(source).toContain('record_operation(FileOperation::Move');
    expect(source).toContain('record_operation(FileOperation::Rename');
  });

  it('retires snapshot rules without touching other preferences or security logs', () => {
    const retained = { menuItemId: 'copy', id: 'keep' };
    localStorage.setItem(
      STORAGE_KEYS.CONTEXT_MENU_RULES,
      JSON.stringify([{ menuItemId: 'version-history', id: 'old' }, retained]),
    );
    localStorage.setItem(STORAGE_KEYS.AI_AUDIT_LOG, '[{"keep":true}]');
    localStorage.setItem(STORAGE_KEYS.INSTALLED_EXTENSIONS, '[{"id":"keep"}]');
    migrateRetiredSettings();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CONTEXT_MENU_RULES)!)).toEqual([retained]);
    expect(localStorage.getItem(STORAGE_KEYS.AI_AUDIT_LOG)).toBe('[{"keep":true}]');
    expect(localStorage.getItem(STORAGE_KEYS.INSTALLED_EXTENSIONS)).toBe('[{"id":"keep"}]');
    migrateRetiredSettings();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CONTEXT_MENU_RULES)!)).toEqual([retained]);
  });

  it('keeps malformed rules recoverable while migrating unrelated retired settings', () => {
    localStorage.setItem(STORAGE_KEYS.CONTEXT_MENU_RULES, '{invalid');
    localStorage.setItem(STORAGE_KEYS.SETTINGS, '{"fontSize":"xl","language":"en"}');
    migrateRetiredSettings();
    expect(localStorage.getItem(STORAGE_KEYS.CONTEXT_MENU_RULES)).toBe('{invalid');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toEqual({ language: 'en' });
  });

  it('loads and refreshes cleanup suggestions without an audit API', async () => {
    const { result } = renderHook(() => usePerformanceStats('/test', files, true));
    await waitFor(() =>
      expect(result.current.suggestions.some((s) => s.id === 'large-files')).toBe(true),
    );
    expect(result.current).not.toHaveProperty('recentOps');
    const calls = mocks.getTrashItems.mock.calls.length;
    await act(async () => {
      result.current.refreshStats();
    });
    expect(mocks.getTrashItems.mock.calls.length).toBeGreaterThan(calls);
  });

  it('keeps cleanup suggestions working when the trash request fails', async () => {
    mocks.getTrashItems.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePerformanceStats('/test', files, true));
    await waitFor(() =>
      expect(result.current.suggestions.some((s) => s.id === 'large-files')).toBe(true),
    );
    expect(result.current.isLoading).toBe(false);
  });

  it('does not leave retired accessibility classes but respects system media queries', () => {
    for (const path of ['index.css', 'styles/liquid-glass.css', 'styles/fluid-glass.css']) {
      const source = read(`apps/client/src/${path}`);
      expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
        /html[^{}]*\.(reduce-motion|reduce-transparency|enhanced-focus|high-contrast)[^{}]*\{/,
      );
      expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    }
  });
});
