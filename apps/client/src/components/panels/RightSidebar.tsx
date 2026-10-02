import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import React, { useRef, useState, useMemo, useLayoutEffect, useEffect } from 'react';
import ExtensionPanelHost from './ExtensionPanelHost';
import { extensionHost } from '@/lib/extension-host';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FileEntry, FolderSizeInfo } from '@/lib/tauri-api';
import { X } from 'lucide-react';
import './side-panels.css';

// Lazy-loaded panels -- only loaded when the user switches to their tab
const PreviewPanel = React.lazy(() => import('./PreviewPanel'));
const MarketplacePanel = React.lazy(() => import('./MarketplacePanel'));
const PerformanceDashboard = React.lazy(() => import('./PerformanceDashboard'));
const PiChatPanel = React.lazy(() => import('./PiChatPanel'));
const ChatgptBridgePanel = React.lazy(() => import('./ChatgptBridgePanel'));
const WeixinBridgePanel = React.lazy(() => import('./WeixinBridgePanel'));
const ComparePreview = React.lazy(() => import('@/components/previews/ComparePreview'));

interface Theme {
  name: string;
  primary: string;
  bg: string;
  surface: string;
  text: string;
}

interface RightSidebarProps {
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  rightPanelTab: string;
  width?: number;
  /** Canvas mode: the chat tab splits into document + conversation columns. */
  canvasMode?: boolean;
  setCanvasMode?: (on: boolean) => void;
  selectedFile: FileEntry | null;
  formatFileSize: (bytes: number) => string;
  formatDate: (timestamp: number) => string;
  themes: Record<string, Theme>;
  theme: string;
  applyTheme: (themeKey: string) => void;
  allFiles: FileEntry[];
  selectedFiles?: Set<string>;
  getFolderSize?: (path: string) => FolderSizeInfo | null;
  isCalculatingSize?: (path: string) => boolean;
  currentPath: string;
  navigateToPath?: (path: string) => void;
}

const RightSidebar = ({
  rightSidebarCollapsed,
  setRightSidebarCollapsed,
  rightPanelTab: requestedPanelTab,
  width,
  canvasMode = false,
  setCanvasMode,
  selectedFile,
  formatFileSize,
  formatDate,
  themes: _themes,
  theme: _theme,
  applyTheme: _applyTheme,
  allFiles,
  selectedFiles,
  getFolderSize,
  isCalculatingSize,
  currentPath,
  navigateToPath,
}: RightSidebarProps) => {
  const rightPanelTab = requestedPanelTab === 'agent-manager' ? 'preview' : requestedPanelTab;
  const { t: tUi } = useTranslation();
  const outerRef = useRef<HTMLDivElement>(null);
  const panelContentRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [compareDismissed, setCompareDismissed] = useState(false);

  // Canvas mode only applies to the chat tab: document column + chat column.
  const canvasActive = canvasMode && rightPanelTab === 'chat';

  // Multi-selection still supports keyboard navigation without a navigation bar.
  const [previewIndex, setPreviewIndex] = useState(0);

  // Build the ordered list of selected files for keyboard navigation.
  const selectedFileEntries = useMemo<FileEntry[]>(() => {
    if (!selectedFiles || selectedFiles.size <= 1) return [];
    const fileMap = new Map(allFiles.map((f) => [f.path, f]));
    const entries: FileEntry[] = [];
    for (const path of selectedFiles) {
      const fe = fileMap.get(path);
      if (fe) entries.push(fe);
    }
    return entries;
  }, [selectedFiles, allFiles]);

  const multiSelected = selectedFileEntries.length > 1;
  const isPreviewTab = rightPanelTab === 'preview';

  // Clamp previewIndex when selection changes
  useEffect(() => {
    if (multiSelected) {
      setPreviewIndex((prev) => Math.min(prev, selectedFileEntries.length - 1));
    } else {
      setPreviewIndex(0);
    }
  }, [selectedFileEntries.length, multiSelected]);

  const keyboardPreviewFile =
    multiSelected && isPreviewTab ? (selectedFileEntries[previewIndex] ?? null) : null;

  const effectivePreviewFile = keyboardPreviewFile ?? selectedFile;

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!multiSelected || !isPreviewTab || rightSidebarCollapsed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when the panel or its children are focused
      const panel = panelContentRef.current;
      if (!panel) return;
      // Check if focus is within the right sidebar panel, or if nothing specific is focused
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement;
      if (isInputFocused) return;

      const total = selectedFileEntries.length;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Check if inside the right sidebar
        if (!panel.contains(activeEl) && activeEl !== document.body) return;

        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+Left/Right: jump to first/last
          setPreviewIndex(e.key === 'ArrowLeft' ? 0 : total - 1);
        } else {
          setPreviewIndex((prev) => {
            if (e.key === 'ArrowLeft') return Math.max(0, prev - 1);
            return Math.min(total - 1, prev + 1);
          });
        }
      } else if (e.key === 'Enter') {
        if (!panel.contains(activeEl) && activeEl !== document.body) return;
        // Open the previewed file
        const file = selectedFileEntries[previewIndex];
        if (file) {
          import('@/lib/tauri-api').then(({ TauriAPI }) => {
            TauriAPI.openFile(file.path).catch(console.error);
          });
        }
      } else if (e.key === ' ') {
        if (!panel.contains(activeEl) && activeEl !== document.body) return;
        // Space: toggle file selection is handled by the grid, skip here
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [multiSelected, isPreviewTab, rightSidebarCollapsed, selectedFileEntries, previewIndex]);

  // ── Two-file comparison ────────────────────────────────────────────────────
  const compareFiles = useMemo<[FileEntry, FileEntry] | null>(() => {
    if (!selectedFiles || selectedFiles.size !== 2) return null;
    const paths = Array.from(selectedFiles);
    const fileMap = new Map(allFiles.map((f) => [f.path, f]));
    const left = fileMap.get(paths[0]);
    const right = fileMap.get(paths[1]);
    if (left && right) return [left, right];
    return null;
  }, [selectedFiles, allFiles]);

  // Reset dismissed state when selection changes away from 2 files
  const prevCompareKey = useRef<string>('');
  const compareKey = compareFiles ? `${compareFiles[0].path}|${compareFiles[1].path}` : '';
  if (compareKey !== prevCompareKey.current) {
    prevCompareKey.current = compareKey;
    if (compareDismissed) setCompareDismissed(false);
  }

  const showCompare = isPreviewTab && compareFiles !== null && !compareDismissed;

  // Measure the actual rendered height of the outer div (set by flex cross-axis stretch)
  useLayoutEffect(() => {
    if (rightSidebarCollapsed) return;
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const h = el.clientHeight;
      if (h > 0) setMeasuredHeight(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rightSidebarCollapsed]);

  if (rightSidebarCollapsed) return null;

  const showSelectedPreview = isPreviewTab && multiSelected && !showCompare;

  // Props bag passed to extension panels (for any extension that uses PanelRenderProps)
  // Convert selectedFiles Set<string> to the array format extensions expect
  const extensionSelectedFiles = selectedFiles
    ? allFiles
        .filter((f) => selectedFiles.has(f.path))
        .map((f) => ({
          name: f.name,
          path: f.path,
          is_dir: f.is_dir,
        }))
    : undefined;

  const extensionProps = {
    selectedFile: showSelectedPreview ? effectivePreviewFile : selectedFile,
    formatFileSize,
    formatDate,
    allFiles,
    selectedFiles: extensionSelectedFiles,
    getFolderSize,
    isCalculatingSize,
    currentPath,
    navigateToPath,
  };

  // Get panel title for header
  const getTabTitle = () => {
    if (canvasActive) return i18n.t('piChat.canvasTitle');
    if (showCompare) return i18n.t('dialogs.compareFiles.title');
    if (rightPanelTab === 'preview') return i18n.t('extensionsBar.preview');
    if (rightPanelTab === 'chat') return i18n.t('extensionsBar.chat');
    if (rightPanelTab === 'weixin-bridge') return i18n.t('extensionsBar.weixin');
    if (rightPanelTab === 'chatgpt-bridge') return i18n.t('extensionsBar.chatgptBridge');
    if (rightPanelTab === 'performance') return i18n.t('extensionsBar.performance');
    if (rightPanelTab === 'marketplace') return i18n.t('extensionsBar.marketplace');
    const panel = extensionHost.getPanel(rightPanelTab);
    if (panel) return panel.title;
    return rightPanelTab;
  };
  const tabTitle = getTabTitle();

  return (
    <div
      ref={outerRef}
      className={`wisp-inspector border-l border-xp-border${isPreviewTab ? '' : 'wisp-panel-workspace'}`}
      data-panel={rightPanelTab}
      data-canvas={canvasActive ? 'on' : undefined}
      style={{
        // 画布模式是「读文档」场景：双栏太挤没意义，地板抬到 720。
        width: canvasActive ? Math.max(width ?? 320, 720) : (width ?? 320),
        flexShrink: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Inner container with explicit measured height -- bypasses WebView2 flex height bug */}
      <div
        style={{
          height: measuredHeight || '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          className={`wisp-inspector-header wisp-no-select flex items-center border-b border-xp-border ${
            isPreviewTab ? 'wisp-inspector-header-preview justify-end' : 'justify-between px-3 py-2'
          }`}
          style={{ flexShrink: 0 }}
          role="toolbar"
          aria-label={tabTitle}
        >
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{tabTitle}</h3>
            {!isPreviewTab && tUi(`panelPurpose.${rightPanelTab}`, { defaultValue: '' }) && (
              <p className="wisp-panel-purpose">{tUi(`panelPurpose.${rightPanelTab}`)}</p>
            )}
          </div>
          <button
            onClick={() => setRightSidebarCollapsed(true)}
            className="wisp-icon-button ml-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-xp-text-secondary hover:bg-xp-surface-light"
            aria-label={
              rightPanelTab === 'preview'
                ? i18n.t('previewPanel.closePreview')
                : i18n.t('panel.collapse', { defaultValue: '收起' })
            }
            title={
              rightPanelTab === 'preview'
                ? i18n.t('previewPanel.closePreview')
                : i18n.t('panel.collapse', { defaultValue: '收起' })
            }
          >
            <X size={16} />
          </button>
        </div>

        {/* Panel content */}
        <div
          ref={panelContentRef}
          className={isPreviewTab ? undefined : 'wisp-panel-body'}
          tabIndex={-1}
          style={{
            flex: '1 1 0%',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            outline: 'none',
          }}
        >
          <React.Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-xs text-xp-text-secondary">
                {tUi('panels.notes.loading')}
              </div>
            }
          >
            {(() => {
              if (showCompare && compareFiles) {
                return (
                  <ErrorBoundary>
                    <ComparePreview
                      leftFile={compareFiles[0]}
                      rightFile={compareFiles[1]}
                      onDismiss={() => setCompareDismissed(true)}
                      formatFileSize={formatFileSize}
                      formatDate={formatDate}
                    />
                  </ErrorBoundary>
                );
              }
              if (rightPanelTab === 'preview') {
                return (
                  <ErrorBoundary>
                    <PreviewPanel
                      selectedFile={showSelectedPreview ? effectivePreviewFile : selectedFile}
                      formatFileSize={formatFileSize}
                      formatDate={formatDate}
                      getFolderSize={getFolderSize}
                      isCalculatingSize={isCalculatingSize}
                      currentPath={currentPath}
                    />
                  </ErrorBoundary>
                );
              }
              if (rightPanelTab === 'performance') {
                return (
                  <ErrorBoundary>
                    <PerformanceDashboard
                      currentPath={currentPath}
                      allFiles={allFiles}
                      navigateToPath={navigateToPath}
                    />
                  </ErrorBoundary>
                );
              }
              if (rightPanelTab === 'chat') {
                if (canvasActive) {
                  return (
                    <ErrorBoundary>
                      {/* 画布模式：左文档（预览面板）+ 右对话，同屏并排 */}
                      <div className="flex h-full min-h-0 w-full" data-testid="canvas-split">
                        <div className="flex min-w-0 flex-1 flex-col">
                          <PreviewPanel
                            selectedFile={selectedFile}
                            formatFileSize={formatFileSize}
                            formatDate={formatDate}
                            getFolderSize={getFolderSize}
                            isCalculatingSize={isCalculatingSize}
                            currentPath={currentPath}
                          />
                        </div>
                        <div className="flex w-[300px] shrink-0 flex-col border-l border-xp-border">
                          <PiChatPanel
                            currentPath={currentPath}
                            canvasMode
                            onCanvasChange={setCanvasMode}
                          />
                        </div>
                      </div>
                    </ErrorBoundary>
                  );
                }
                return (
                  <ErrorBoundary>
                    <PiChatPanel
                      currentPath={currentPath}
                      canvasMode={false}
                      onCanvasChange={setCanvasMode}
                    />
                  </ErrorBoundary>
                );
              }
              if (rightPanelTab === 'weixin-bridge') {
                return (
                  <ErrorBoundary>
                    <WeixinBridgePanel currentPath={currentPath} />
                  </ErrorBoundary>
                );
              }
              if (rightPanelTab === 'chatgpt-bridge') {
                return (
                  <ErrorBoundary>
                    <ChatgptBridgePanel currentPath={currentPath} />
                  </ErrorBoundary>
                );
              }
              if (rightPanelTab === 'marketplace') {
                return (
                  <ErrorBoundary>
                    <MarketplacePanel />
                  </ErrorBoundary>
                );
              }
              return (
                <ErrorBoundary>
                  <ExtensionPanelHost panelId={rightPanelTab} builtinProps={extensionProps} />
                </ErrorBoundary>
              );
            })()}
          </React.Suspense>
        </div>
      </div>
    </div>
  );
};

export default RightSidebar;
