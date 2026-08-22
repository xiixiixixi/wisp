import React, { useState, useEffect } from 'react';
import { FolderClosed, File, Clock, ChevronDown, ChevronRight, GripHorizontal } from 'lucide-react';
import { TauriAPI, RecentFile } from '@/lib/tauri-api';
import { useWindowEvent } from '@/hooks/use-window-event';
import { useTranslation } from 'react-i18next';

interface SidebarRecentProps {
  navigateToPath: (path: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sectionHeight: number | undefined;
  onResizeStart: (sectionId: string, e: React.MouseEvent) => void;
}

const SidebarRecent = ({
  navigateToPath,
  collapsed,
  onToggleCollapsed,
  sectionHeight,
  onResizeStart,
}: SidebarRecentProps) => {
  const { t } = useTranslation();
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);

  const loadRecent = () => {
    TauriAPI.getRecentFiles(10)
      .then((files) => setRecentFiles(files))
      .catch((error) => console.error('Failed to load recent files:', error));
  };

  useEffect(() => {
    loadRecent();
  }, []);

  useWindowEvent('recent-files-changed', loadRecent);

  return (
    <div
      className="border-b border-xp-border"
      role="region"
      aria-label={t('sidebar.recent')}
      data-sidebar-section="recent"
    >
      <button
        className="hover:bg-xp-surface-light/50 flex w-full items-center px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-xp-text-muted transition-colors"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={t('sidebar.toggleRecent')}
      >
        {collapsed ? (
          <ChevronRight className="mr-1 h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="mr-1 h-3 w-3 flex-shrink-0" />
        )}
        <Clock size={12} className="mr-1 flex-shrink-0" />
        {t('sidebar.recent')}
      </button>
      {!collapsed && (
        <div
          className="space-y-0.5 overflow-y-auto px-3 pb-2"
          style={sectionHeight ? { maxHeight: sectionHeight } : undefined}
        >
          {recentFiles.length === 0 ? (
            <p className="py-1 text-xs text-xp-text-secondary">{t('sidebar.noRecent')}</p>
          ) : (
            recentFiles.map((rf) => (
              <div
                key={rf.path}
                className="flex w-full cursor-pointer items-center rounded px-2 py-1 text-xs transition-colors hover:bg-xp-surface-light"
                onClick={() => {
                  if (rf.file_type === 'folder') {
                    navigateToPath(rf.path);
                  } else {
                    const sep = rf.path.includes('/') ? '/' : '\\';
                    const parts = rf.path.split(sep);
                    parts.pop();
                    const parentDir = parts.join(sep);
                    if (parentDir) navigateToPath(parentDir);
                  }
                }}
                title={rf.path}
              >
                {rf.file_type === 'folder' ? (
                  <FolderClosed size={14} className="mr-2 flex-shrink-0 text-xp-blue" />
                ) : (
                  <File size={14} className="mr-2 flex-shrink-0 text-xp-text-secondary" />
                )}
                <span className="flex-1 truncate">{rf.name}</span>
              </div>
            ))
          )}
        </div>
      )}
      {/* Resize handle */}
      {!collapsed && (
        <div
          className="hover:bg-xp-blue/30 group flex h-2 cursor-row-resize items-center justify-center transition-colors"
          onMouseDown={(e) => onResizeStart('recent', e)}
        >
          <GripHorizontal className="text-xp-text-muted/20 group-hover:text-xp-text-muted/60 h-3 w-4 transition-colors" />
        </div>
      )}
    </div>
  );
};

export default SidebarRecent;
