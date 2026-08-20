import React, { useState, useMemo } from 'react';
import { FileEntry, TauriAPI } from '@/lib/tauri-api';
import { useDraggable } from '@/hooks/use-draggable';
import { ViewComponentProps } from './FileGridTypes';

interface TreeRowProps {
  file: FileEntry;
  depth: number;
  selectedFiles: Set<string>;
  allFiles: FileEntry[];
  expandedFolders: Set<string>;
  folderContents: Map<string, FileEntry[]>;
  toggleFolder: (folderPath: string) => void;
  getFileIcon: (file: FileEntry) => React.ReactNode;
  handleFileClick: (file: FileEntry, event: React.MouseEvent) => void;
  handleFileDoubleClick: (file: FileEntry) => void;
  handleFileRightClick: (file: FileEntry, event: React.MouseEvent) => void;
}

// Sort files: directories first, then by name
const sortFiles = (files: FileEntry[]): FileEntry[] =>
  [...files].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1;
    if (!a.is_dir && b.is_dir) return 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

const TreeRow = ({
  file,
  depth,
  selectedFiles,
  allFiles,
  expandedFolders,
  folderContents,
  toggleFolder,
  getFileIcon,
  handleFileClick,
  handleFileDoubleClick,
  handleFileRightClick,
}: TreeRowProps) => {
  const dragHandlers = useDraggable({ file, selectedFiles, allFiles });
  const expanded = file.is_dir && expandedFolders.has(file.path);

  return (
    <div>
      <div
        role="treeitem"
        aria-selected={selectedFiles.has(file.path)}
        aria-expanded={file.is_dir ? expanded : undefined}
        aria-label={`${file.name}${file.is_dir ? ', folder' : ', file'}`}
        tabIndex={0}
        data-drop-target={file.is_dir ? file.path : undefined}
        className={`flex min-w-0 cursor-pointer select-none items-center overflow-hidden rounded px-2 py-1 transition-colors hover:bg-xp-surface-light ${
          selectedFiles.has(file.path)
            ? 'bg-xp-purple/20 border-xp-purple/40 border'
            : 'border border-transparent text-xp-text'
        } `}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        {...dragHandlers}
        onClick={(e) => {
          if (file.is_dir) {
            toggleFolder(file.path);
          }
          handleFileClick(file, e);
        }}
        onDoubleClick={() => handleFileDoubleClick(file)}
        onContextMenu={(e) => handleFileRightClick(file, e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleFileDoubleClick(file);
          if (e.key === ' ') {
            e.preventDefault();
            const syntheticEvent = {
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              metaKey: e.metaKey,
              button: 0,
            } as React.MouseEvent;
            handleFileClick(file, syntheticEvent);
          }
        }}
      >
        <div className="flex min-w-0 flex-1 items-center space-x-1">
          {file.is_dir && (
            <button
              className="flex-shrink-0 rounded p-0.5 hover:bg-xp-surface-light"
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(file.path);
              }}
              aria-label={
                expandedFolders.has(file.path) ? `Collapse ${file.name}` : `Expand ${file.name}`
              }
            >
              <svg
                className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
          {!file.is_dir && <div className="w-4 flex-shrink-0" />}

          <span className="mr-2 flex-shrink-0 text-sm">{getFileIcon(file)}</span>
          <span className="flex-1 truncate text-sm">{file.name}</span>
        </div>
      </div>

      {/* Show nested content if expanded */}
      {expanded && (
        <div role="group">
          {folderContents.has(file.path) ? (
            sortFiles(folderContents.get(file.path) ?? []).map((childFile) => (
              <TreeRow
                key={childFile.path}
                file={childFile}
                depth={depth + 1}
                selectedFiles={selectedFiles}
                allFiles={allFiles}
                expandedFolders={expandedFolders}
                folderContents={folderContents}
                toggleFolder={toggleFolder}
                getFileIcon={getFileIcon}
                handleFileClick={handleFileClick}
                handleFileDoubleClick={handleFileDoubleClick}
                handleFileRightClick={handleFileRightClick}
              />
            ))
          ) : (
            <div
              className="flex items-center py-1 text-xs text-xp-text-muted"
              style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
            >
              <svg className="mr-2 h-3 w-3 animate-spin" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                  clipRule="evenodd"
                />
              </svg>
              Loading...
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Tree View Component
const TreeView = ({
  files,
  selectedFiles,
  getFileIcon,
  handleFileClick,
  handleFileDoubleClick,
  handleFileRightClick,
  handleBackgroundRightClick,
}: ViewComponentProps) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderContents, setFolderContents] = useState<Map<string, FileEntry[]>>(new Map());

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath);
      } else {
        newSet.add(folderPath);
        // Load folder contents if not already loaded
        if (!folderContents.has(folderPath)) {
          loadFolderContents(folderPath);
        }
      }
      return newSet;
    });
  };

  const loadFolderContents = async (folderPath: string) => {
    try {
      const contents = await TauriAPI.readDirectory(folderPath);
      setFolderContents((prev) => new Map(prev.set(folderPath, contents)));
    } catch (error) {
      console.error('Failed to load folder contents:', error);
      // Set empty array on error so we don't keep trying
      setFolderContents((prev) => new Map(prev.set(folderPath, [])));
    }
  };

  const sortedFiles = useMemo(() => sortFiles(files), [files]);

  // Draggable rows need the full file list so multi-select drags can collect
  // every selected path, including items inside expanded folders.
  const allFiles = useMemo(() => {
    const result = [...files];
    for (const contents of folderContents.values()) {
      result.push(...contents);
    }
    return result;
  }, [files, folderContents]);

  return (
    <div
      className="overflow-hidden text-sm"
      role="tree"
      aria-label="File tree"
      onContextMenu={handleBackgroundRightClick || undefined}
    >
      {sortedFiles.map((file) => (
        <TreeRow
          key={file.path}
          file={file}
          depth={0}
          selectedFiles={selectedFiles}
          allFiles={allFiles}
          expandedFolders={expandedFolders}
          folderContents={folderContents}
          toggleFolder={toggleFolder}
          getFileIcon={getFileIcon}
          handleFileClick={handleFileClick}
          handleFileDoubleClick={handleFileDoubleClick}
          handleFileRightClick={handleFileRightClick}
        />
      ))}
    </div>
  );
};

export default TreeView;
