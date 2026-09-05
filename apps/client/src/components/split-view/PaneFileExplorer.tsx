import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { FileEntry } from '@/lib/tauri-api';
import {
  getFileIcon,
  formatFileSize,
  formatFolderSize,
  formatDate,
  viewModes,
  sortOptions,
  type FileGroup,
  type SortField,
} from '@/lib/utils';
import OperationBar from '@/components/explorer/OperationBar';
import { useClipboardContext } from '@/contexts/ExplorerContext';
import FileGrid from '@/components/explorer/FileGrid';
import TokenizerStatusIndicator from '@/components/ui/TokenizerStatusIndicator';
import { SizeDistributionChart } from '@/components/explorer/SizeDistributionChart';
import FolderColorLegend from '@/components/explorer/FolderColorLegend';
import { getAllFolderColors } from '@/lib/folder-colors';
import { useSmartView } from '@/hooks/use-smart-view';

interface PaneFileExplorerProps {
  viewMode: string;
  setViewMode: (mode: string) => void;
  sortBy: SortField;
  setSortBy: (field: SortField) => void;
  sortOrder: 'asc' | 'desc';
  toggleSortOrder: () => void;
  groupByDate: boolean;
  setGroupByDate: (enabled: boolean) => void;
  sortedFiles: FileEntry[];
  fileGroups: FileGroup[] | null;
  isLoading: boolean;
  selectedFiles: Set<string>;
  setSelectedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  currentPath: string;
  groupId: string;
  handleCreateFolder: () => void;
  handleDelete: () => void;
  handleFileClick: (file: FileEntry, event: React.MouseEvent) => void;
  handleFileDoubleClick: (file: FileEntry) => void;
  onFileRightClick: (file: FileEntry, event: React.MouseEvent) => void;
  onBgRightClick: (event: React.MouseEvent) => void;
  getFolderSize: (path: string) => import('@/lib/tauri-api').FolderSizeInfo | null;
  isCalculatingSize: (path: string) => boolean;
  calculateFolderSize: (path: string) => void;
  setBottomPanelCollapsed: (collapsed: boolean) => void;
  setBottomPanelTab: (tab: string) => void;
  onAdvancedSelection: () => void;
  onQuickLook?: (file: import('@/lib/tauri-api').FileEntry) => void;
  /** Inline rename handler: called with (oldPath, newName), returns true on success */
  onRenameFile?: (oldPath: string, newName: string) => Promise<boolean>;
  /** Optional: create a new file in the current directory */
  onCreateFile?: () => void;
  /** Optional: compress selected files */
  onCompress?: () => void;
  /** Optional: extract selected archive */
  onExtract?: () => void;
  /** Optional: show properties for selected files */
  onProperties?: () => void;
}

const PaneFileExplorer = React.memo(
  ({
    viewMode,
    setViewMode,
    sortBy,
    setSortBy,
    sortOrder,
    toggleSortOrder,
    groupByDate,
    setGroupByDate,
    sortedFiles,
    fileGroups,
    isLoading,
    selectedFiles,
    setSelectedFiles,
    currentPath,
    groupId,
    handleCreateFolder,
    handleDelete,
    handleFileClick,
    handleFileDoubleClick,
    onFileRightClick,
    onBgRightClick,
    getFolderSize,
    isCalculatingSize,
    calculateFolderSize,
    setBottomPanelCollapsed,
    setBottomPanelTab,
    onAdvancedSelection,
    onQuickLook,
    onRenameFile,
    onCreateFile,
    onCompress,
    onExtract,
    onProperties,
  }: PaneFileExplorerProps) => {
    const [showSizeBadges, setShowSizeBadges] = useState(false);
    const toggleSizeBadges = useCallback(() => setShowSizeBadges((prev) => !prev), []);

    // Clicking blank space clears the selection (Finder/VS Code behaviour).
    // The mouse-down position is tracked so a drag release (e.g. a file drag
    // ending on empty space) is not mistaken for a genuine click.
    const bgMouseDownPosRef = useRef<{ x: number; y: number } | null>(null);

    const handleBackgroundClick = useCallback(
      (e: React.MouseEvent) => {
        const down = bgMouseDownPosRef.current;
        bgMouseDownPosRef.current = null;
        if (!down) return;
        if (Math.abs(e.clientX - down.x) > 3 || Math.abs(e.clientY - down.y) > 3) return;
        // Ignore clicks that landed on a file row or an interactive control
        const hitInteractive = (e.target as HTMLElement).closest(
          '[data-file-path], [data-gallery-path], [role="treeitem"], [role="option"], [role="row"], button, input, textarea, select, a',
        );
        if (hitInteractive) return;
        setSelectedFiles(new Set());
      },
      [setSelectedFiles],
    );

    // Preserve scroll position across file list refetches (hot-reload, file changes)
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const savedScrollTopRef = useRef<number>(0);
    const prevFilesLenRef = useRef<number>(0);

    // Save scroll position before files change
    useEffect(() => {
      if (scrollContainerRef.current) {
        savedScrollTopRef.current = scrollContainerRef.current.scrollTop;
      }
    });

    // Restore scroll position after files update (only if same folder, not navigation)
    useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      // Only restore if the file count is similar (refetch, not navigation)
      const prevLen = prevFilesLenRef.current;
      const newLen = sortedFiles.length;
      if (prevLen > 0 && Math.abs(newLen - prevLen) < prevLen * 0.5) {
        requestAnimationFrame(() => {
          container.scrollTop = savedScrollTopRef.current;
        });
      }
      prevFilesLenRef.current = newLen;
    }, [sortedFiles]);
    const clipboardCtx = useClipboardContext();

    // ── Smart view detection ──────────────────────────────────────────────────
    const { suggestedView, setSavedView, clearSavedView, isAutoDetected } = useSmartView(
      sortedFiles,
      currentPath,
    );

    // Apply the suggested view when it changes (on path change or initial detection)
    const appliedSuggestionRef = useRef<string | null>(null);
    useEffect(() => {
      const key = `${currentPath}:${suggestedView}`;
      if (appliedSuggestionRef.current !== key) {
        appliedSuggestionRef.current = key;
        setViewMode(suggestedView);
      }
    }, [suggestedView, currentPath, setViewMode]);

    // Wrap setViewMode to persist the user's manual choice
    const handleSetViewMode = useCallback(
      (mode: string) => {
        setSavedView(mode);
        setViewMode(mode);
      },
      [setSavedView, setViewMode],
    );

    // Folder color filter
    const [colorFilter, setColorFilter] = useState<string | null>(null);
    const handleColorFilter = useCallback((colorId: string | null) => setColorFilter(colorId), []);

    const handlePreviewSelected = useCallback(() => {
      if (!onQuickLook || selectedFiles.size !== 1) return;
      const selectedPath = selectedFiles.values().next().value;
      const selectedEntry = sortedFiles.find((file) => file.path === selectedPath);
      if (selectedEntry) onQuickLook(selectedEntry);
    }, [onQuickLook, selectedFiles, sortedFiles]);

    // Re-read folder colors on change so the filter stays in sync
    const [folderColorVersion, setFolderColorVersion] = useState(0);
    useEffect(() => {
      const handler = () => setFolderColorVersion((v) => v + 1);
      window.addEventListener('folder-colors-changed', handler);
      return () => window.removeEventListener('folder-colors-changed', handler);
    }, []);

    // When a color filter is active, only show folders with that color (plus all non-folder items)
    const displayFiles = useMemo(() => {
      // folderColorVersion triggers re-computation when folder colors change
      void folderColorVersion;
      if (!colorFilter) return sortedFiles;
      const allColors = getAllFolderColors();
      const matchingPaths = new Set(
        allColors.filter((c) => c.colorId === colorFilter).map((c) => c.path),
      );
      return sortedFiles.filter((f) => !f.is_dir || matchingPaths.has(f.path));
    }, [sortedFiles, colorFilter, folderColorVersion]);

    // Clear color filter when navigating to a different directory
    useEffect(() => {
      setColorFilter(null);
    }, [currentPath]);

    return (
      <>
        {(isLoading || displayFiles.length > 0 || selectedFiles.size > 0) && (
          <OperationBar
            viewMode={viewMode}
            setViewMode={handleSetViewMode}
            viewModes={viewModes}
            isAutoDetected={isAutoDetected}
            onClearAutoDetect={clearSavedView}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortOrder={sortOrder}
            toggleSortOrder={toggleSortOrder}
            sortOptions={sortOptions}
            groupByDate={groupByDate}
            setGroupByDate={setGroupByDate}
            handleCreateFolder={handleCreateFolder}
            handleDelete={handleDelete}
            selectedFiles={selectedFiles}
            setBottomPanelCollapsed={setBottomPanelCollapsed}
            setBottomPanelTab={setBottomPanelTab}
            onSelectAll={() => {
              const newSet = new Set(sortedFiles.map((f) => f.path));
              setSelectedFiles(newSet);
            }}
            onSelectNone={() => {
              setSelectedFiles(new Set());
            }}
            onInvertSelection={() => {
              const allPaths = sortedFiles.map((f) => f.path);
              setSelectedFiles((prev) => {
                const next = new Set<string>();
                for (const p of allPaths) {
                  if (!prev.has(p)) next.add(p);
                }
                return next;
              });
            }}
            onAdvancedSelection={onAdvancedSelection}
            showSizeBadges={showSizeBadges}
            onToggleSizeBadges={toggleSizeBadges}
            onCompress={onCompress}
            onExtract={onExtract}
            onProperties={onProperties}
            currentPath={currentPath}
            onCopy={clipboardCtx.copySelectedFiles}
            onCut={clipboardCtx.cutSelectedFiles}
            onPaste={clipboardCtx.pasteFiles}
            hasClipboard={clipboardCtx.hasClipboard}
            onPreview={onQuickLook ? handlePreviewSelected : undefined}
            statusAccessory={
              <div className="mr-1 flex items-center gap-2">
                {showSizeBadges && <SizeDistributionChart files={displayFiles} />}
                <FolderColorLegend
                  files={sortedFiles}
                  onFilterByColor={handleColorFilter}
                  activeColorFilter={colorFilter}
                />
                <TokenizerStatusIndicator />
              </div>
            }
          />
        )}

        <div
          ref={scrollContainerRef}
          className="wisp-file-scroll wisp-pane-container flex-1 overflow-auto"
          onMouseDown={(e) => {
            bgMouseDownPosRef.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={handleBackgroundClick}
        >
          <FileGrid
            files={displayFiles}
            fileGroups={colorFilter ? null : fileGroups}
            isLoading={isLoading}
            viewMode={viewMode}
            selectedFiles={selectedFiles}
            currentPath={currentPath}
            groupId={groupId}
            getFileIcon={getFileIcon}
            formatFileSize={formatFileSize}
            formatFolderSize={formatFolderSize}
            formatDate={formatDate}
            handleFileClick={handleFileClick}
            handleFileDoubleClick={handleFileDoubleClick}
            handleFileRightClick={onFileRightClick}
            handleBackgroundRightClick={onBgRightClick}
            getFolderSize={getFolderSize}
            isCalculatingSize={isCalculatingSize}
            calculateFolderSize={calculateFolderSize}
            onQuickLook={onQuickLook}
            showSizeBadges={showSizeBadges}
            onRenameFile={onRenameFile}
            onCreateFolder={handleCreateFolder}
            onCreateFile={onCreateFile}
          />
        </div>
      </>
    );
  },
);
PaneFileExplorer.displayName = 'PaneFileExplorer';

export default PaneFileExplorer;
