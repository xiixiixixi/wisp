import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import { isEditableFile } from '@/lib/editable-files';
import { extensionHost } from '@/lib/extension-host';
import { toast } from '@/hooks/use-toast';
import type { TabItem } from '@/types/split-view';
import type { VimModeState } from '@/hooks/use-vim-mode';
import VimModeIndicator from '@/components/explorer/VimModeIndicator';
import { GitBranch, Redo2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Detect encoding from raw bytes (BOM sniffing + heuristic). */
const detectEncoding = (bytes: Uint8Array): string => {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'UTF-8 BOM';
  }
  // Check UTF-32 before UTF-16 since UTF-32 LE starts with the same FF FE prefix
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xfe &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00
  ) {
    return 'UTF-32 LE';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0xfe &&
    bytes[3] === 0xff
  ) {
    return 'UTF-32 BE';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'UTF-16 LE';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'UTF-16 BE';

  // Heuristic: check for null bytes (indicates binary or UTF-16 without BOM)
  let hasNullByte = false;
  let hasHighByte = false;
  const checkLen = Math.min(bytes.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0x00) hasNullByte = true;
    if (bytes[i] > 0x7f) hasHighByte = true;
  }

  if (hasNullByte) return 'Binary';
  if (!hasHighByte) return 'ASCII';
  return 'UTF-8';
};

/** Detect line endings from text content. */
const detectLineEndings = (text: string): 'CRLF' | 'LF' | 'CR' | null => {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const crCount = (text.replace(/\r\n/g, '').match(/\r/g) || []).length;
  const lfCount = (text.replace(/\r\n/g, '').match(/\n/g) || []).length;

  if (crlfCount === 0 && lfCount === 0 && crCount === 0) return null;
  if (crlfCount >= lfCount && crlfCount >= crCount) return 'CRLF';
  if (crCount > lfCount) return 'CR';
  return 'LF';
};

/** Check if a FileEntry is a text/editable file. */
const isTextFile = (file: FileEntry): boolean => {
  return !file.is_dir && isEditableFile(file);
};

// ── Badge sub-component ──────────────────────────────────────────────────────

const badgeStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: '3px',
  background: 'var(--xp-surface-light, rgba(255,255,255,0.06))',
  color: 'var(--xp-text-muted, #888)',
  fontSize: '11px',
  lineHeight: '16px',
  cursor: 'default',
  whiteSpace: 'nowrap',
  border: '1px solid var(--xp-border, rgba(255,255,255,0.08))',
};

const Badge = ({
  children,
  title,
  ariaLabel,
}: {
  children: React.ReactNode;
  title?: string;
  ariaLabel?: string;
}) => {
  return (
    <span style={badgeStyle} title={title} aria-label={ariaLabel}>
      {children}
    </span>
  );
};

// ── Separator ────────────────────────────────────────────────────────────────

const separatorStyle: React.CSSProperties = {
  width: '1px',
  height: '12px',
  background: 'var(--xp-border, rgba(255,255,255,0.1))',
  flexShrink: 0,
};

const Separator = () => {
  return <span style={separatorStyle} aria-hidden="true" />;
};

// ── Cursor position event type ───────────────────────────────────────────────

export interface CursorPositionDetail {
  line: number;
  column: number;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface StatusBarProps {
  files: FileEntry[];
  selectedFiles: Set<string>;
  currentPath: string;
  /** The currently active tab object, used to detect editor mode. */
  activeTab?: TabItem | null;
  /** Vim mode state — when provided and enabled, shows the vim indicator in the left section. */
  vimState?: VimModeState | null;
  /** Show restore buttons for collapsed panels in the status bar. */
  rightSidebarCollapsed?: boolean;
  bottomPanelCollapsed?: boolean;
  onRestoreRightSidebar?: () => void;
  onRestoreBottomPanel?: () => void;
}

// ── Git status counts ────────────────────────────────────────────────────────

interface GitInfo {
  branch: string;
  modifiedCount: number;
  stagedCount: number;
  untrackedCount: number;
}

interface UndoRedoStatus {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
}

const EMPTY_UNDO_REDO_STATUS: UndoRedoStatus = {
  canUndo: false,
  canRedo: false,
  undoDescription: null,
  redoDescription: null,
};

// ── Component ────────────────────────────────────────────────────────────────

const StatusBar = ({
  files,
  selectedFiles,
  currentPath,
  activeTab,
  vimState,
  rightSidebarCollapsed,
  bottomPanelCollapsed,
  onRestoreRightSidebar,
  onRestoreBottomPanel,
}: StatusBarProps) => {
  const { t } = useTranslation();
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [freeSpace, setFreeSpace] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<string | null>(null);
  const [lineEnding, setLineEnding] = useState<'CRLF' | 'LF' | 'CR' | null>(null);
  const [cursorPos, setCursorPos] = useState<CursorPositionDetail | null>(null);
  const [undoRedoStatus, setUndoRedoStatus] = useState<UndoRedoStatus>(EMPTY_UNDO_REDO_STATUS);
  const [historyAction, setHistoryAction] = useState<'undo' | 'redo' | null>(null);

  // Track previous path to avoid redundant git lookups
  const prevPathRef = useRef<string>('');

  // Determine the single selected file (if exactly one text file is selected)
  const singleSelectedTextFile = React.useMemo(() => {
    if (selectedFiles.size !== 1) return null;
    const selectedPath = Array.from(selectedFiles)[0];
    const file = files.find((f) => f.path === selectedPath);
    if (file && isTextFile(file)) return file;
    return null;
  }, [files, selectedFiles]);

  // Determine if we're in editor mode
  const isEditorMode = activeTab?.type === 'editor' && !!activeTab.path;

  // The file path to analyze (editor file takes priority over selection)
  const analysisFilePath = React.useMemo(() => {
    if (isEditorMode && activeTab?.path) return activeTab.path;
    if (singleSelectedTextFile) return singleSelectedTextFile.path;
    return null;
  }, [isEditorMode, activeTab?.path, singleSelectedTextFile]);

  // Compute selection size
  const selectionSize = React.useMemo(() => {
    if (selectedFiles.size === 0) return 0;
    let total = 0;
    for (const f of files) {
      if (selectedFiles.has(f.path) && !f.is_dir) {
        total += f.size;
      }
    }
    return total;
  }, [files, selectedFiles]);

  // Fetch git info (branch + file status counts)
  const refreshGitInfo = useCallback(async () => {
    if (currentPath.startsWith('wisp://')) return;
    try {
      const repoPath = await TauriAPI.findGitRepository(currentPath);
      if (repoPath) {
        const info = await TauriAPI.getRepositoryInfo(repoPath);
        setGitInfo({
          branch: info.current_branch,
          modifiedCount: info.modified_files?.length ?? 0,
          stagedCount: info.staged_files?.length ?? 0,
          untrackedCount: info.untracked_files?.length ?? 0,
        });
      } else {
        setGitInfo(null);
      }
    } catch {
      setGitInfo(null);
    }
  }, [currentPath]);

  // Refresh when path changes
  useEffect(() => {
    if (currentPath.startsWith('wisp://') || currentPath === prevPathRef.current) return;
    prevPathRef.current = currentPath;
    refreshGitInfo();
  }, [currentPath, refreshGitInfo]);

  // Re-fetch when extension switches branches
  useEffect(() => {
    const handler = () => {
      refreshGitInfo();
    };
    window.addEventListener('git-branch-changed', handler);
    return () => window.removeEventListener('git-branch-changed', handler);
  }, [refreshGitInfo]);

  // Fetch free disk space when currentPath changes
  useEffect(() => {
    if (currentPath.startsWith('wisp://')) {
      setFreeSpace(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const drives = await TauriAPI.listDrives();
        if (cancelled) return;
        const normalised = currentPath.replace(/\\/g, '/').toLowerCase();
        let match = drives[0];
        for (const d of drives) {
          const dp = d.path.replace(/\\/g, '/').toLowerCase();
          if (normalised.startsWith(dp)) {
            match = d;
            break;
          }
        }
        if (match && !cancelled) {
          setFreeSpace(formatFileSize(match.free_space));
        }
      } catch {
        if (!cancelled) setFreeSpace(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  // Detect encoding and line endings for selected/editor file
  useEffect(() => {
    if (!analysisFilePath) {
      setEncoding(null);
      setLineEnding(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Read first 8KB as binary to detect encoding
        const bytes = await TauriAPI.readBinaryFile(analysisFilePath);
        if (cancelled) return;

        const sample = bytes.slice(0, 8192);
        const detectedEncoding = detectEncoding(sample);
        setEncoding(detectedEncoding);

        // Only detect line endings for non-binary files
        if (detectedEncoding !== 'Binary') {
          // Decode the sample as text to check line endings
          const decoder = new TextDecoder('utf-8', { fatal: false });
          const text = decoder.decode(sample);
          const endings = detectLineEndings(text);
          if (!cancelled) setLineEnding(endings);
        } else {
          if (!cancelled) setLineEnding(null);
        }
      } catch {
        if (!cancelled) {
          setEncoding(null);
          setLineEnding(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysisFilePath]);

  // Listen for cursor position events from FileEditorView
  const handleCursorChange = useCallback((e: Event) => {
    const detail = (e as CustomEvent<CursorPositionDetail>).detail;
    setCursorPos(detail);
  }, []);

  useEffect(() => {
    window.addEventListener('editor-cursor-change', handleCursorChange);
    return () => window.removeEventListener('editor-cursor-change', handleCursorChange);
  }, [handleCursorChange]);

  const refreshUndoRedoStatus = useCallback(async () => {
    try {
      const snapshot = await TauriAPI.getUndoHistory();
      const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
      const undoCount = Math.max(0, Math.min(snapshot.undo_count ?? 0, entries.length));
      setUndoRedoStatus({
        canUndo: undoCount > 0,
        canRedo: undoCount < entries.length,
        undoDescription: entries[undoCount - 1]?.description ?? null,
        redoDescription: entries[undoCount]?.description ?? null,
      });
    } catch {
      setUndoRedoStatus(EMPTY_UNDO_REDO_STATUS);
    }
  }, []);

  useEffect(() => {
    refreshUndoRedoStatus();
    const refresh = () => refreshUndoRedoStatus();
    window.addEventListener('files-changed', refresh);
    return () => window.removeEventListener('files-changed', refresh);
  }, [refreshUndoRedoStatus]);

  const handleHistoryAction = useCallback(
    async (action: 'undo' | 'redo') => {
      setHistoryAction(action);
      try {
        const result =
          action === 'undo' ? await TauriAPI.undoOperation() : await TauriAPI.redoOperation();
        if (result.success) {
          toast({
            title: t(action === 'undo' ? 'statusBar.undoDone' : 'statusBar.redoDone'),
            description: result.message,
          });
          window.dispatchEvent(new CustomEvent('files-changed'));
        }
      } catch (error) {
        toast({
          variant: 'destructive',
          title: t(action === 'undo' ? 'statusBar.undoFailed' : 'statusBar.redoFailed'),
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setHistoryAction(null);
        await refreshUndoRedoStatus();
      }
    },
    [refreshUndoRedoStatus, t],
  );

  // Clear cursor position when leaving editor mode
  useEffect(() => {
    if (!isEditorMode) {
      setCursorPos(null);
    }
  }, [isEditorMode]);

  // Truncate path for display
  const displayPath = React.useMemo(() => {
    if (currentPath.startsWith('wisp://')) return currentPath.replace('wisp://', '');
    const maxLen = 60;
    if (currentPath.length <= maxLen) return currentPath;
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(sep);
    if (parts.length <= 3) return currentPath;
    const head = parts.slice(0, 1).join(sep);
    const tail = parts.slice(-2).join(sep);
    return `${head}${sep}...${sep}${tail}`;
  }, [currentPath]);

  // Git status summary for tooltip
  const gitTooltip = React.useMemo(() => {
    if (!gitInfo) return '';
    const parts = [t('statusBar.branch', { name: gitInfo.branch })];
    if (gitInfo.modifiedCount > 0) {
      parts.push(t('statusBar.modified', { count: gitInfo.modifiedCount }));
    }
    if (gitInfo.stagedCount > 0) parts.push(t('statusBar.staged', { count: gitInfo.stagedCount }));
    if (gitInfo.untrackedCount > 0) {
      parts.push(t('statusBar.untracked', { count: gitInfo.untrackedCount }));
    }
    return parts.join(' | ');
  }, [gitInfo, t]);

  const totalGitChanges = gitInfo
    ? gitInfo.modifiedCount + gitInfo.stagedCount + gitInfo.untrackedCount
    : 0;

  // Handle click on the git branch button
  const handleGitClick = useCallback(() => {
    if (extensionHost.isExtensionActive('git')) {
      // Open the git extension's bottom tab panel
      window.dispatchEvent(new CustomEvent('wisp-set-bottom-tab', { detail: { tab: 'git' } }));
    } else {
      toast({
        title: t('statusBar.gitNotInstalled'),
        description: t('statusBar.gitNotInstalledDesc'),
      });
    }
  }, [t]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="wisp-statusbar flex flex-shrink-0 select-none items-center justify-between border-t border-xp-border bg-xp-surface px-3 text-xs text-xp-text-secondary"
      style={{ minHeight: '24px', height: '24px' }}
    >
      {/* Left section */}
      <div className="flex items-center gap-3" aria-label={t('statusBar.fileCount')}>
        {/* Vim Mode Indicator */}
        {vimState && vimState.enabled && (
          <>
            <VimModeIndicator
              mode={vimState.mode}
              pendingKeys={vimState.pendingKeys}
              learningMode={vimState.learningMode}
            />
            <Separator />
          </>
        )}

        <span>{t('statusBar.items', { count: files.length })}</span>
        {selectedFiles.size > 0 && (
          <span>
            {t('statusBar.selected', { count: selectedFiles.size })}
            {selectionSize > 0 && ` (${formatFileSize(selectionSize)})`}
          </span>
        )}
      </div>

      {/* Center section */}
      <div className="flex-1 truncate px-4 text-center opacity-80" title={currentPath}>
        {displayPath}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        {(undoRedoStatus.canUndo || undoRedoStatus.canRedo) && (
          <>
            <div
              className="flex items-center rounded-md border border-xp-border bg-muted p-0.5"
              role="group"
              aria-label={t('statusBar.historyActions')}
            >
              <button
                type="button"
                onClick={() => handleHistoryAction('undo')}
                disabled={!undoRedoStatus.canUndo || historyAction !== null}
                className="flex h-5 w-6 items-center justify-center rounded text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text disabled:pointer-events-none disabled:opacity-30"
                title={
                  undoRedoStatus.undoDescription
                    ? t('statusBar.undoDescription', {
                        description: undoRedoStatus.undoDescription,
                      })
                    : t('statusBar.undo')
                }
                aria-label={t('statusBar.undo')}
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => handleHistoryAction('redo')}
                disabled={!undoRedoStatus.canRedo || historyAction !== null}
                className="flex h-5 w-6 items-center justify-center rounded text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text disabled:pointer-events-none disabled:opacity-30"
                title={
                  undoRedoStatus.redoDescription
                    ? t('statusBar.redoDescription', {
                        description: undoRedoStatus.redoDescription,
                      })
                    : t('statusBar.redo')
                }
                aria-label={t('statusBar.redo')}
              >
                <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <Separator />
          </>
        )}

        {/* Cursor position (editor mode only) */}
        {isEditorMode && cursorPos && (
          <>
            <Badge
              title={t('statusBar.cursorPosition')}
              ariaLabel={t('statusBar.lineFull', { line: cursorPos.line, col: cursorPos.column })}
            >
              {t('statusBar.line', { line: cursorPos.line, col: cursorPos.column })}
            </Badge>
            <Separator />
          </>
        )}

        {/* Encoding */}
        {encoding && encoding !== 'Binary' && (
          <>
            <Badge
              title={t('statusBar.encoding', { encoding })}
              ariaLabel={t('statusBar.encoding', { encoding })}
            >
              {encoding}
            </Badge>
            <Separator />
          </>
        )}

        {/* Line endings */}
        {lineEnding && (
          <>
            <Badge
              title={t('statusBar.lineEndings', { type: lineEnding })}
              ariaLabel={t('statusBar.lineEndings', { type: lineEnding })}
            >
              {lineEnding}
            </Badge>
            <Separator />
          </>
        )}

        {/* Git info */}
        {gitInfo && (
          <>
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-white/10 active:bg-white/15"
              style={{
                cursor: 'pointer',
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                fontSize: 'inherit',
                lineHeight: 'inherit',
              }}
              title={gitTooltip || t('statusBar.openGitPanel')}
              aria-label={gitTooltip || t('statusBar.openGitPanel')}
              onClick={handleGitClick}
            >
              <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
              {gitInfo.branch}
              {totalGitChanges > 0 && (
                <span
                  style={{
                    marginLeft: '3px',
                    padding: '0 4px',
                    borderRadius: '8px',
                    fontSize: '10px',
                    lineHeight: '14px',
                    fontWeight: 600,
                    background: 'var(--xp-orange, #e8a854)',
                    color: 'var(--xp-bg, #0a0a1a)',
                  }}
                  title={`${gitInfo.modifiedCount}M ${gitInfo.stagedCount}S ${gitInfo.untrackedCount}U`}
                >
                  {totalGitChanges}
                </span>
              )}
            </button>
            <Separator />
          </>
        )}

        {/* Free disk space */}
        {freeSpace && (
          <span
            title={t('statusBar.freeSpace')}
            aria-label={t('statusBar.freeSpaceLabel', { size: freeSpace })}
          >
            {t('statusBar.freeSpaceShort', { size: freeSpace })}
          </span>
        )}

        {/* Collapsed-panel restore toggles (moved here from the floating
            corner buttons, which overlaid page content) */}
        {onRestoreRightSidebar && rightSidebarCollapsed && (
          <button
            type="button"
            className="rounded p-0.5 transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
            title={t('panelToggles.togglePanel')}
            aria-label={t('panelToggles.togglePanel')}
            onClick={onRestoreRightSidebar}
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        {onRestoreBottomPanel && bottomPanelCollapsed && (
          <button
            type="button"
            data-tour="bottom-panel-toggle"
            className="rounded p-0.5 transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
            title={t('panelToggles.toggleTerminal')}
            aria-label={t('panelToggles.toggleTerminal')}
            onClick={onRestoreBottomPanel}
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default StatusBar;
