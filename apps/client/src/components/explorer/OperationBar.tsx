import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Rows3,
  BarChart3,
  Settings,
  FolderPlus,
  FilePlus,
  Package,
  PackageOpen,
  Info,
  Terminal,
  Copy,
  Scissors,
  Clipboard,
  Eye,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SortField } from '@/lib/utils';

interface ViewMode {
  id: string;
  name: string;
  icon: React.ReactNode;
}

interface SortOption {
  id: SortField;
  name: string;
  icon: React.ReactNode;
}

interface OperationBarProps {
  viewMode: string;
  setViewMode: (mode: string) => void;
  viewModes: Record<string, ViewMode>;
  sortBy: SortField;
  setSortBy: (sortBy: SortField) => void;
  sortOrder: 'asc' | 'desc';
  toggleSortOrder: () => void;
  sortOptions: Record<SortField, SortOption>;
  groupByDate?: boolean;
  setGroupByDate?: (enabled: boolean) => void;
  handleCreateFolder: () => void;
  handleDelete: () => void;
  selectedFiles: Set<string>;
  setBottomPanelCollapsed: (collapsed: boolean) => void;
  setBottomPanelTab: (tab: 'terminal' | 'output' | 'git' | string) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  onInvertSelection?: () => void;
  onAdvancedSelection?: () => void;
  /** Whether size heatmap badges are shown */
  showSizeBadges?: boolean;
  /** Toggle size heatmap badges */
  onToggleSizeBadges?: () => void;
  /** Whether the current view mode was auto-detected */
  isAutoDetected?: boolean;
  /** Callback to clear the auto-detected view and re-trigger detection */
  onClearAutoDetect?: () => void;
  /** Optional action callbacks for the gear menu */
  onCreateFile?: () => void;
  onCompress?: () => void;
  onExtract?: () => void;
  onProperties?: () => void;
  onCopyPath?: () => void;
  /** Current directory path (used for Open in Terminal fallback) */
  currentPath?: string;
  /** Clipboard actions */
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  hasClipboard?: boolean;
  onPreview?: () => void;
  statusAccessory?: React.ReactNode;
}

const OperationBar = ({
  viewMode,
  setViewMode,
  viewModes,
  sortBy,
  setSortBy,
  sortOrder,
  toggleSortOrder,
  sortOptions,
  groupByDate,
  setGroupByDate,
  handleCreateFolder,
  handleDelete,
  selectedFiles,
  setBottomPanelCollapsed,
  setBottomPanelTab,
  onSelectAll: _onSelectAll,
  onSelectNone,
  onInvertSelection: _onInvertSelection,
  onAdvancedSelection: _onAdvancedSelection,
  showSizeBadges,
  onToggleSizeBadges,
  isAutoDetected: _isAutoDetected,
  onClearAutoDetect: _onClearAutoDetect,
  onCreateFile,
  onCompress,
  onExtract,
  onProperties,
  onCopyPath,
  currentPath: _currentPath,
  onCopy,
  onCut,
  onPaste,
  hasClipboard,
  onPreview,
  statusAccessory,
}: OperationBarProps) => {
  const { t } = useTranslation();
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anyOpen = isViewDropdownOpen || isSortDropdownOpen || isActionsDropdownOpen;
    if (!anyOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setIsViewDropdownOpen(false);
        setIsSortDropdownOpen(false);
        setIsActionsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isViewDropdownOpen, isSortDropdownOpen, isActionsDropdownOpen]);

  const handleOpenTerminal = () => {
    setBottomPanelCollapsed(false);
    setBottomPanelTab('terminal');
    setIsActionsDropdownOpen(false);
  };

  const getSortLabel = (id: SortField) =>
    t(`operationBar.sortOptions.${id}`, {
      defaultValue: sortOptions?.[id]?.name || t('operationBar.sortOptions.name'),
    });
  const getViewLabel = (id: string) =>
    t(`operationBar.viewModes.${id}`, {
      defaultValue: viewModes[id]?.name || t('operationBar.viewModes.medium'),
    });
  const currentSortLabel = getSortLabel(sortBy);
  const currentViewLabel = getViewLabel(viewMode);
  const currentSortOrder = t(
    sortOrder === 'asc' ? 'operationBar.ascending' : 'operationBar.descending',
  );

  if (selectedFiles.size > 0) {
    return (
      <div
        ref={barRef}
        className="border-b border-xp-blue/30 bg-xp-blue/5 px-3 py-1.5"
        role="toolbar"
        aria-label={t('operationBar.selectionActions')}
      >
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-xp-lime px-1.5 text-[11px] font-bold text-[#1d1c1a]"
              aria-hidden="true"
            >
              {selectedFiles.size}
            </span>
            <span className="truncate text-xs font-semibold text-xp-text" aria-live="polite">
              {t('common.selected', { count: selectedFiles.size })}
            </span>
            {onSelectNone && (
              <button
                type="button"
                onClick={onSelectNone}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                title={t('topBar.clearSelection')}
                aria-label={t('topBar.clearSelection')}
              >
                <X size={13} aria-hidden="true" />
                <span>{t('common.clear')}</span>
              </button>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {selectedFiles.size === 1 && onPreview && (
              <button
                type="button"
                onClick={onPreview}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.preview')}
                aria-label={t('operationBar.preview')}
              >
                <Eye size={15} aria-hidden="true" />
                <span className="hidden lg:inline">{t('common.preview')}</span>
              </button>
            )}
            {onCopy && (
              <button
                type="button"
                onClick={onCopy}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('contextMenu.copy')}
                aria-label={t('contextMenu.copy')}
              >
                <Copy size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('contextMenu.copy')}</span>
              </button>
            )}
            {onCut && (
              <button
                type="button"
                onClick={onCut}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('contextMenu.cut')}
                aria-label={t('contextMenu.cut')}
              >
                <Scissors size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('contextMenu.cut')}</span>
              </button>
            )}
            {onCompress && selectedFiles.size > 1 && (
              <button
                type="button"
                onClick={onCompress}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.compress')}
                aria-label={t('operationBar.compress')}
              >
                <Package size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('operationBar.compress')}</span>
              </button>
            )}
            {onExtract && selectedFiles.size === 1 && (
              <button
                type="button"
                onClick={onExtract}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.extract')}
                aria-label={t('operationBar.extract')}
              >
                <PackageOpen size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('operationBar.extract')}</span>
              </button>
            )}
            {onProperties && selectedFiles.size === 1 && (
              <button
                type="button"
                onClick={onProperties}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light"
                title={t('operationBar.properties')}
                aria-label={t('operationBar.properties')}
              >
                <Info size={15} aria-hidden="true" />
                <span className="hidden xl:inline">{t('operationBar.properties')}</span>
              </button>
            )}
            <div className="mx-1 h-5 w-px bg-xp-border" aria-hidden="true" />
            <button
              type="button"
              onClick={handleDelete}
              className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-xp-red transition-colors hover:bg-xp-red/10"
              title={t('operationBar.deleteItems', { count: selectedFiles.size })}
              aria-label={t('operationBar.deleteItemsAria', { count: selectedFiles.size })}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span className="hidden lg:inline">{t('contextMenu.delete')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={barRef}
      className="wisp-operationbar wisp-no-select relative z-30 border-b border-xp-border bg-xp-surface px-3 py-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1">
          {/* Sort Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              aria-label={t('operationBar.sortBy', {
                name: currentSortLabel,
                order: currentSortOrder,
              })}
            >
              <span className="whitespace-nowrap">{currentSortLabel}</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>

            {isSortDropdownOpen && sortOptions && (
              <div className="border-xp-border/60 absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-xl border bg-xp-popover py-1 shadow-xl">
                {Object.values(sortOptions).map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      if (sortBy === option.id) {
                        toggleSortOrder();
                      } else {
                        setSortBy(option.id);
                      }
                      setIsSortDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${
                      sortBy === option.id ? 'text-xp-blue' : ''
                    }`}
                  >
                    <span className="text-xs">{getSortLabel(option.id)}</span>
                    {sortBy === option.id &&
                      (sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </button>
                ))}

                {/* Group by Date toggle inside sort dropdown */}
                {setGroupByDate && (
                  <>
                    <div className="my-1 border-t border-xp-border" />
                    <button
                      onClick={() => {
                        setGroupByDate(!groupByDate);
                        setIsSortDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${
                        groupByDate ? 'text-xp-blue' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Rows3 size={13} className="inline-block" />
                        <span className="text-xs">{t('operationBar.groupByDate')}</span>
                      </div>
                      {groupByDate && (
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Separator */}
          <div className="h-4 w-px bg-xp-border" />
          {/* View Mode Dropdown */}
          <div className="relative flex items-center gap-1">
            <button
              onClick={() => setIsViewDropdownOpen(!isViewDropdownOpen)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              aria-label={t('operationBar.viewMode', {
                name: currentViewLabel,
              })}
            >
              <span className="text-sm">{viewModes[viewMode]?.icon}</span>
              <span className="whitespace-nowrap">{currentViewLabel}</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>

            {isViewDropdownOpen && (
              <div className="border-xp-border/60 absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-xl border bg-xp-popover py-1 shadow-xl">
                {Object.values(viewModes).map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => {
                      setViewMode(mode.id);
                      setIsViewDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-xp-surface-light ${
                      viewMode === mode.id ? 'text-xp-blue' : ''
                    }`}
                  >
                    <span className="text-sm">{mode.icon}</span>
                    <span className="text-xs">{getViewLabel(mode.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Selection actions appear contextually instead of filling every empty state. */}
          {selectedFiles.size > 0 && (
            <div className="ml-1 flex items-center gap-0.5 rounded-md border border-xp-border bg-muted px-1">
              <span className="px-1.5 text-[11px] font-medium tabular-nums text-xp-blue">
                {selectedFiles.size}
              </span>
              {selectedFiles.size === 1 && onPreview && (
                <button
                  onClick={onPreview}
                  className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('operationBar.preview')}
                  aria-label={t('operationBar.preview')}
                >
                  <Eye size={15} />
                </button>
              )}
              {onCopy && (
                <button
                  onClick={onCopy}
                  className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('contextMenu.copy')}
                  aria-label={t('contextMenu.copy')}
                >
                  <Copy size={15} />
                </button>
              )}
              {onCut && (
                <button
                  onClick={onCut}
                  className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                  title={t('contextMenu.cut')}
                  aria-label={t('contextMenu.cut')}
                >
                  <Scissors size={15} />
                </button>
              )}
              <button
                onClick={handleDelete}
                className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-red/10 hover:text-xp-red"
                title={t('contextMenu.delete')}
                aria-label={t('contextMenu.delete')}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
          {onPaste && hasClipboard && (
            <button
              onClick={onPaste}
              className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              title={t('contextMenu.paste')}
              aria-label={t('contextMenu.paste')}
            >
              <Clipboard size={15} />
            </button>
          )}

          {/* Separator */}
          <div className="h-4 w-px bg-xp-border" />

          {/* Size Map toggle */}
          {onToggleSizeBadges && (
            <button
              onClick={onToggleSizeBadges}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                showSizeBadges
                  ? 'bg-xp-blue/10 text-xp-blue'
                  : 'text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text'
              }`}
              title={
                showSizeBadges
                  ? t('operationBar.hideSizeHeatmap')
                  : t('operationBar.showSizeHeatmap')
              }
              aria-label={
                showSizeBadges
                  ? t('operationBar.hideSizeHeatmap')
                  : t('operationBar.showSizeHeatmap')
              }
              aria-pressed={showSizeBadges}
            >
              <BarChart3 size={14} />
              <span className="whitespace-nowrap">{t('operationBar.sizeMap')}</span>
            </button>
          )}

          {/* Separator */}
          <div className="h-4 w-px bg-xp-border" />
        </div>

        <div className="flex items-center space-x-1">
          {statusAccessory}

          {/* Action Buttons */}
          <button
            onClick={handleCreateFolder}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-xp-text transition-colors hover:bg-xp-surface-light hover:text-xp-blue"
            title={t('operationBar.createFolder')}
            aria-label={t('operationBar.createFolder')}
          >
            <FolderPlus size={16} />
            <span className="hidden xl:inline">{t('operationBar.newFolder')}</span>
          </button>

          <button
            onClick={() => {
              setBottomPanelCollapsed(false);
              setBottomPanelTab('terminal');
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            title={t('operationBar.openTerminal')}
            aria-label={t('operationBar.openTerminal')}
          >
            <Terminal size={16} />
          </button>

          {/* Gear / Actions dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsActionsDropdownOpen(!isActionsDropdownOpen)}
              className="rounded p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              title={t('operationBar.actionsMenu')}
              aria-label={t('operationBar.actionsMenu')}
              aria-haspopup="menu"
              aria-expanded={isActionsDropdownOpen}
            >
              <Settings size={16} />
            </button>

            {isActionsDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-xp-border bg-xp-popover py-1 shadow-xl backdrop-blur-xl">
                {/* New Folder */}
                <button
                  onClick={() => {
                    handleCreateFolder();
                    setIsActionsDropdownOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-xp-surface-light"
                >
                  <FolderPlus size={14} className="shrink-0 text-xp-text-muted" />
                  <span>{t('operationBar.newFolder')}</span>
                </button>

                {/* New File */}
                {onCreateFile && (
                  <button
                    onClick={() => {
                      onCreateFile();
                      setIsActionsDropdownOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-xp-surface-light"
                  >
                    <FilePlus size={14} className="shrink-0 text-xp-text-muted" />
                    <span>{t('operationBar.newFile')}</span>
                  </button>
                )}

                <div className="my-1 border-t border-xp-border" />

                {/* Compress */}
                {onCompress && (
                  <button
                    onClick={() => {
                      onCompress();
                      setIsActionsDropdownOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-xp-surface-light"
                  >
                    <Package size={14} className="shrink-0 text-xp-text-muted" />
                    <span>{t('operationBar.compress')}</span>
                  </button>
                )}

                {/* Extract */}
                {onExtract && (
                  <button
                    onClick={() => {
                      onExtract();
                      setIsActionsDropdownOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-xp-surface-light"
                  >
                    <PackageOpen size={14} className="shrink-0 text-xp-text-muted" />
                    <span>{t('operationBar.extract')}</span>
                  </button>
                )}

                <div className="my-1 border-t border-xp-border" />

                {/* Open in Terminal */}
                <button
                  onClick={handleOpenTerminal}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-xp-surface-light"
                >
                  <Terminal size={14} className="shrink-0 text-xp-text-muted" />
                  <span>{t('operationBar.openInTerminal')}</span>
                </button>

                {/* Copy Path */}
                {onCopyPath && (
                  <button
                    onClick={() => {
                      onCopyPath();
                      setIsActionsDropdownOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-xp-surface-light"
                  >
                    <Copy size={14} className="shrink-0 text-xp-text-muted" />
                    <span>{t('operationBar.copyPath')}</span>
                  </button>
                )}

                <div className="my-1 border-t border-xp-border" />

                {/* Properties */}
                {onProperties && (
                  <button
                    onClick={() => {
                      onProperties();
                      setIsActionsDropdownOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-xp-surface-light"
                  >
                    <Info size={14} className="shrink-0 text-xp-text-muted" />
                    <span>{t('operationBar.properties')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OperationBar;
