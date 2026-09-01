import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@/hooks/use-draggable';
import { useDroppable } from '@/hooks/use-droppable';
import { TagDots, GitStatusDot, LockBadge, isImageFile, isHiddenFile } from './FileGridHelpers';
import { FileGridItemProps, SizeBadgeInfo } from './FileGridTypes';
import { formatFileSize } from '@/lib/utils';
import { getFolderColorHex } from '@/lib/folder-colors';
import { validateFileName } from '@/lib/validate-filename';
import ThumbnailPreview from './ThumbnailPreview';
import { FileReferenceBadge } from './FileReferenceBadge';

// ─── Chat file display name helper ───────────────────────────────────────────

const getChatDisplayName = (filename: string): string => {
  let name = filename.replace(/\.chat$/, '');
  // Remove date prefix like "2026-03-14_"
  name = name.replace(/^\d{4}-\d{2}-\d{2}_/, '');
  // Replace hyphens/underscores with spaces
  return name.replace(/[-_]/g, ' ');
};

// ─── Size badge component ────────────────────────────────────────────────────

const SizeBadge = ({
  file,
  info,
}: {
  file: { name: string; size: number; is_dir: boolean };
  info: SizeBadgeInfo;
}) => {
  let percentileLabel: string;
  if (info.percentile >= 90) {
    percentileLabel = 'Top 10%';
  } else if (info.percentile >= 75) {
    percentileLabel = 'Top 25%';
  } else if (info.percentile >= 50) {
    percentileLabel = 'Top 50%';
  } else {
    percentileLabel = 'Bottom 50%';
  }

  const tooltipText = file.is_dir
    ? `${file.name} — Folder`
    : `${file.name} — ${formatFileSize(file.size)} (${percentileLabel} in this folder)`;

  return (
    <div
      title={tooltipText}
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: info.color,
        border: '1.5px solid var(--xp-border)',
        zIndex: 5,
        cursor: 'default',
        transition: 'transform 0.15s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.3)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
      }}
    />
  );
};

// ─── Inline rename validation icon ──────────────────────────────────────────

const ValidationIcon = ({ valid, warning }: { valid: boolean; warning: boolean }) => {
  if (warning) {
    // Yellow warning triangle
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        style={{ flexShrink: 0, marginLeft: 4 }}
      >
        <path
          d="M12 2L1 21h22L12 2z"
          fill="currentColor"
          stroke="currentColor"
          className="text-[var(--xp-yellow)]"
          strokeWidth="1"
        />
        <path
          d="M12 10v4"
          stroke="currentColor"
          className="text-[var(--xp-text)]"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="17" r="1" fill="currentColor" className="text-[var(--xp-text)]" />
      </svg>
    );
  }
  if (!valid) {
    // Red X
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        style={{ flexShrink: 0, marginLeft: 4 }}
      >
        <circle cx="12" cy="12" r="10" fill="currentColor" className="text-[var(--xp-red)]" />
        <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  // Green checkmark
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0, marginLeft: 4 }}
    >
      <circle cx="12" cy="12" r="10" fill="currentColor" className="text-[var(--xp-green)]" />
      <path
        d="M7 12l3 3 7-7"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// ─── Helper: select filename without extension ──────────────────────────────

const selectFileNameWithoutExtension = (input: HTMLInputElement, name: string, isDir: boolean) => {
  if (isDir) {
    input.select();
    return;
  }
  const lastDot = name.lastIndexOf('.');
  if (lastDot > 0) {
    input.setSelectionRange(0, lastDot);
  } else {
    input.select();
  }
};

// ─── Helper: character offset inside a label for a pixel position ───────────

/**
 * Map a click position onto the label's text and return the character offset
 * the caret should land on — Finder's label-click rename places the caret
 * exactly where the name was clicked. Falls back to undefined when the
 * point does not resolve onto the label's text node.
 */
const caretOffsetAtPoint = (label: HTMLElement, x: number, y: number): number | undefined => {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset: number | undefined;
  if (doc.caretRangeFromPoint) {
    // WebKit / Blink
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (doc.caretPositionFromPoint) {
    // Firefox
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !label.contains(node)) return undefined;
  return offset;
};

// ─── Inline rename input component ──────────────────────────────────────────

export const InlineRenameInput = React.memo(
  ({
    fileName,
    isDir,
    isListView,
    existingNames,
    initialCaretOffset,
    onConfirm,
    onCancel,
    onTab,
    filePath,
  }: {
    fileName: string;
    isDir: boolean;
    isListView: boolean;
    existingNames: string[];
    /** Character offset for a label-click rename (caret where clicked);
     *  null/undefined selects the base name (Enter/F2 path, Finder-like). */
    initialCaretOffset?: number | null;
    onConfirm: (oldPath: string, newName: string) => void;
    onCancel: () => void;
    onTab: (oldPath: string, newName: string | null, direction: 1 | -1) => void;
    filePath: string;
  }) => {
    const [value, setValue] = useState(fileName);
    const inputRef = useRef<HTMLInputElement>(null);
    const confirmedRef = useRef(false);

    // Auto-focus on mount. Label-click renames place a collapsed caret where
    // the name was clicked; keyboard-triggered renames select the base name
    // (extension excluded), matching Finder.
    useEffect(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      if (typeof initialCaretOffset === 'number' && initialCaretOffset >= 0) {
        const pos = Math.min(initialCaretOffset, fileName.length);
        input.setSelectionRange(pos, pos);
      } else {
        selectFileNameWithoutExtension(input, fileName, isDir);
      }
      // Mount-only: the caret offset applies to how editing started.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const validation = validateFileName(value, existingNames, fileName);

    const handleConfirm = useCallback(
      (viaBlur: boolean) => {
        if (confirmedRef.current) return;
        const trimmed = value.trim();
        if (trimmed === fileName) {
          confirmedRef.current = true;
          onCancel();
          return;
        }
        if (!validation.valid) {
          // Finder keeps the editor open on an invalid name (empty, illegal
          // characters, conflict): the inline warning stays visible instead
          // of silently discarding the edit. Abandon only when focus left.
          if (viaBlur) {
            confirmedRef.current = true;
            onCancel();
          }
          return;
        }
        confirmedRef.current = true;
        onConfirm(filePath, trimmed);
      },
      [value, fileName, validation.valid, onConfirm, onCancel, filePath],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          handleConfirm(false);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          confirmedRef.current = true; // prevent blur from also firing
          onCancel();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          const trimmed = value.trim();
          const direction: 1 | -1 = e.shiftKey ? -1 : 1;
          if (trimmed === fileName) {
            // Nothing to commit — hop to the neighbour, Finder-style.
            confirmedRef.current = true;
            onTab(filePath, null, direction);
          } else if (validation.valid) {
            confirmedRef.current = true;
            onTab(filePath, trimmed, direction);
          }
          // Invalid name: Finder blocks the hop and keeps editing.
        }
      },
      [handleConfirm, onCancel, onTab, value, validation.valid, fileName, filePath],
    );

    const handleBlur = useCallback(() => {
      if (confirmedRef.current) return;
      handleConfirm(true);
    }, [handleConfirm]);

    // Determine border color based on validation
    let borderColor = 'var(--xp-green)';
    if (!validation.valid && !validation.warning) {
      borderColor = 'var(--xp-red)';
    } else if (validation.warning) {
      borderColor = 'var(--xp-yellow)';
    }

    return (
      <div
        style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0 }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          title={validation.message || undefined}
          aria-label="Rename file"
          aria-invalid={!validation.valid}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '2px 6px',
            fontSize: isListView ? '0.75rem' : '0.875rem',
            fontWeight: 500,
            fontFamily: 'inherit',
            color: 'var(--xp-text)',
            background: 'var(--xp-surface)',
            border: `2px solid ${borderColor}`,
            borderRadius: 4,
            outline: 'none',
            transition: 'border-color 0.15s ease',
            // The grid is permanently user-select:none (drag UX), but this
            // input must still allow caret placement and in-field selection.
            userSelect: 'text',
            WebkitUserSelect: 'text',
          }}
        />
        <ValidationIcon valid={validation.valid} warning={validation.warning} />
        {validation.message && (
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: '100%',
              marginTop: 2,
              padding: '2px 6px',
              fontSize: '0.65rem',
              lineHeight: 1.3,
              color: (() => {
                if (validation.warning) return 'var(--xp-yellow)';
                if (!validation.valid) return 'var(--xp-red)';
                return 'var(--xp-text-muted)';
              })(),
              background: 'var(--xp-surface)',
              border: '1px solid var(--xp-border)',
              borderRadius: 3,
              whiteSpace: 'nowrap',
              zIndex: 20,
              pointerEvents: 'none',
            }}
          >
            {validation.message}
          </span>
        )}
      </div>
    );
  },
);

InlineRenameInput.displayName = 'InlineRenameInput';

// ─── Memoized file grid item ─────────────────────────────────────────────────

const FileGridItem = React.memo(
  ({
    file,
    isSelected,
    tags,
    gitStatus,
    isGridView,
    isListView,
    viewMode,
    itemSize,
    selectedFiles,
    allFiles,
    getFileIcon,
    formatFileSize,
    formatFolderSize,
    formatDate,
    onFileClick,
    onFileDoubleClick,
    onFileRightClick,
    getFolderSize,
    isCalculatingSize,
    showSizeBadge,
    sizeBadgeInfo,
    thumbnailUrl,
    isRenaming,
    existingNames,
    initialRenameCaretOffset,
    onRenameConfirm,
    onRenameCancel,
    onRenameTab,
    onRenameStart,
  }: FileGridItemProps) => {
    // Native drag via tauri-plugin-drag (mousedown/mousemove/mouseup)
    const dragHandlers = useDraggable({ file, selectedFiles, allFiles });

    // Folders are drop targets via data-drop-target attribute
    // Visual feedback is applied by DragDropContext setting data-drop-hover / data-drop-invalid
    // Pass isFolder=true so DragDropContext can start the spring-load timer.
    const dropRef = useDroppable(file.path, !file.is_dir, file.is_dir);

    // Folder color coding
    const folderColorHex = file.is_dir ? getFolderColorHex(file.path) : null;

    // ─── Thumbnail hover preview (image files only) ──────────────────────────
    const [showThumb, setShowThumb] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isImage = isImageFile(file);

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isImage || !thumbnailUrl) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setAnchorRect(rect);
        hoverTimerRef.current = setTimeout(() => {
          setShowThumb(true);
        }, 300);
      },
      [isImage, thumbnailUrl],
    );

    const handleMouseLeave = useCallback(() => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setShowThumb(false);
    }, []);

    // Finder: clicking the name label of the already-selected item starts an
    // inline rename. The native drag (mousedown/mousemove/mouseup) still fires
    // a click on mouseup, so only treat it as a label click when the pointer
    // barely moved — dragging the item by its label must keep working.
    const labelPointerDownRef = useRef<{ x: number; y: number } | null>(null);
    const handleLabelPointerDown = useCallback((e: React.PointerEvent) => {
      labelPointerDownRef.current = { x: e.clientX, y: e.clientY };
    }, []);
    const handleLabelClick = useCallback(
      (e: React.MouseEvent<HTMLSpanElement>) => {
        const start = labelPointerDownRef.current;
        labelPointerDownRef.current = null;
        if (!start || !isSelected) return;
        const moved = Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y);
        if (moved > 4) return;
        e.stopPropagation();
        // Finder places the edit caret exactly where the label was clicked,
        // instead of selecting the whole base name (Enter still selects it).
        const offset = caretOffsetAtPoint(e.currentTarget, e.clientX, e.clientY);
        onRenameStart?.(file, offset);
      },
      [isSelected, onRenameStart, file],
    );
    const labelClickHandlers = onRenameStart
      ? { onPointerDown: handleLabelPointerDown, onClick: handleLabelClick }
      : {};

    // ─── Render the file name area (normal label or inline rename input) ──────

    const renderNameArea = () => {
      if (isRenaming && onRenameConfirm && onRenameCancel && onRenameTab && existingNames) {
        return (
          <InlineRenameInput
            fileName={file.name}
            isDir={file.is_dir}
            isListView={isListView}
            existingNames={existingNames}
            initialCaretOffset={initialRenameCaretOffset}
            onConfirm={onRenameConfirm}
            onCancel={onRenameCancel}
            onTab={onRenameTab}
            filePath={file.path}
          />
        );
      }

      return (
        <>
          <span className="min-w-0 cursor-text truncate" {...labelClickHandlers}>
            {file.name.endsWith('.chat') ? getChatDisplayName(file.name) : file.name}
          </span>
          {!isRenaming && <TagDots tags={tags} />}
          <LockBadge isReadonly={file.is_readonly} />
          <GitStatusDot status={gitStatus} />
        </>
      );
    };

    return (
      <div
        ref={dropRef}
        {...(isRenaming ? {} : dragHandlers)}
        role="option"
        aria-selected={isSelected}
        aria-label={`${file.name}${file.is_dir ? ', folder' : ', file'}`}
        data-file-path={file.path}
        tabIndex={
          isSelected || (selectedFiles.size === 0 && allFiles[0]?.path === file.path) ? 0 : -1
        }
        className={`cursor-pointer rounded-[2px] transition-colors duration-150 ${
          isSelected
            ? 'bg-xp-selection border border-xp-blue ring-1 ring-xp-blue'
            : 'border border-transparent hover:bg-xp-surface-light'
        } ${(() => {
          if (isGridView) return 'min-w-0 overflow-hidden p-3 text-center';
          if (isListView) {
            return 'flex min-w-0 items-center space-x-2 overflow-hidden p-2 text-left';
          }
          return 'flex items-center space-x-3 overflow-hidden p-2';
        })()} `}
        style={{ position: 'relative' }}
        onClick={(e) => {
          if (!isRenaming) onFileClick(file, e);
        }}
        onDoubleClick={() => {
          if (!isRenaming) onFileDoubleClick(file);
        }}
        onContextMenu={(e) => {
          if (!isRenaming) onFileRightClick(file, e);
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Folder color bar — left edge indicator */}
        {folderColorHex && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              borderRadius: '4px 0 0 4px',
              backgroundColor: folderColorHex,
              zIndex: 4,
            }}
          />
        )}
        {showSizeBadge && sizeBadgeInfo && <SizeBadge file={file} info={sizeBadgeInfo} />}
        <div
          className={`${itemSize} ${isGridView ? 'mb-2' : ''} flex-shrink-0 ${isHiddenFile(file) && !isRenaming ? 'opacity-60' : ''}`}
          style={folderColorHex ? { color: folderColorHex } : undefined}
        >
          <FileReferenceBadge file={file}>{getFileIcon(file)}</FileReferenceBadge>
        </div>
        <div className={`${isGridView ? 'w-full min-w-0' : 'min-w-0 flex-1'} select-none`}>
          <div
            className={`font-medium ${isHiddenFile(file) && !isRenaming ? 'text-xp-text-muted' : 'text-xp-text'} ${isRenaming ? '' : 'overflow-hidden'} ${isListView ? 'text-xs' : 'text-sm'} ${isGridView ? 'justify-center' : ''} flex items-center`}
            style={isRenaming ? { position: 'relative', overflow: 'visible' } : undefined}
          >
            {renderNameArea()}
          </div>
          {file.name.endsWith('.chat') && !isRenaming && (
            <span className="mt-0.5 inline-block rounded-[2px] bg-xp-purple/20 px-1.5 py-0.5 text-[9px] text-xp-purple">
              Chat
            </span>
          )}
          {!isGridView && !isListView && !isRenaming && (
            <div className="flex items-center space-x-4 text-xs text-xp-text-muted">
              <span>
                {file.is_dir
                  ? formatFolderSize(getFolderSize(file.path), isCalculatingSize(file.path))
                  : formatFileSize(file.size)}
              </span>
              <span>{formatDate(file.modified)}</span>
              <span className="capitalize">{file.file_type}</span>
            </div>
          )}
          {viewMode === 'content' && !isRenaming && (
            <div className="mt-1 text-xs text-xp-text-muted">
              <div>
                {file.is_dir
                  ? formatFolderSize(getFolderSize(file.path), isCalculatingSize(file.path))
                  : formatFileSize(file.size)}
              </div>
              <div>{formatDate(file.modified)}</div>
            </div>
          )}
        </div>
        {/* Thumbnail preview tooltip (portal) */}
        {showThumb &&
          thumbnailUrl &&
          anchorRect &&
          !isRenaming &&
          createPortal(
            <ThumbnailPreview
              thumbnailUrl={thumbnailUrl}
              fileName={file.name}
              fileSize={file.size}
              anchorRect={anchorRect}
              visible={showThumb}
            />,
            document.body,
          )}
      </div>
    );
  },
);

FileGridItem.displayName = 'FileGridItem';

export default FileGridItem;
