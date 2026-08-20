import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/lib/transport';
import { TauriAPI, type ConflictInfo } from '@/lib/tauri-api';
import { validateDrop, buildDestinationPath } from '@/lib/drag-utils';
import { planTransfer, type ConflictPolicy, type TransferPlan } from '@/lib/drag-transfer';
import { parseBrowserDrop, uniqueDroppedName } from '@/lib/drag-drop-content';
import { undoLastTransfer } from '@/hooks/use-transfer-history';
import { ConflictResolutionDialog } from '@/components/dialogs/ConflictResolutionDialog';
import { TransferProgressToast } from '@/components/explorer/TransferProgressToast';

// ── Types ────────────────────────────────────────────────────────────────────

interface DragState {
  isDragging: boolean;
  dragSource: 'internal' | 'external' | null;
  draggedPaths: string[];
  hoveredDropTarget: string | null; // path from data-drop-target
  operation: 'copy' | 'move' | 'link';
}

type DragAction =
  | { type: 'START_DRAG'; paths: string[]; source: 'internal' | 'external'; op: 'copy' | 'move' }
  | { type: 'SET_HOVER'; targetPath: string | null }
  | { type: 'SET_OPERATION'; op: 'copy' | 'move' | 'link' }
  | { type: 'END_DRAG' };

interface DragDropContextValue {
  dragState: DragState;
  /** Register an element as a drop target. Returns cleanup function. */
  registerDropTarget: (path: string, element: HTMLElement) => () => void;
  /** Notify context that an internal drag is starting (from useDraggable) */
  startInternalDrag: (paths: string[]) => void;
  /** End the internal drag state (drag finished outside the window, etc.) */
  endInternalDrag: () => void;
}

interface ConflictRequest {
  sources: string[];
  targetDir: string;
  conflicts: ConflictInfo[];
  mode: 'copy' | 'move';
}

interface ActiveTransfer {
  ids: string[];
  itemCount: number;
  mode: 'copy' | 'move';
  destDir: string;
  silent: boolean;
}

// ── Reducer ──────────────────────────────────────────────────────────────────

const initialState: DragState = {
  isDragging: false,
  dragSource: null,
  draggedPaths: [],
  hoveredDropTarget: null,
  operation: 'move',
};

const dragReducer = (state: DragState, action: DragAction): DragState => {
  switch (action.type) {
    case 'START_DRAG':
      return {
        isDragging: true,
        dragSource: action.source,
        draggedPaths: action.paths,
        hoveredDropTarget: null,
        operation: action.op,
      };
    case 'SET_HOVER':
      if (state.hoveredDropTarget === action.targetPath) return state;
      return { ...state, hoveredDropTarget: action.targetPath };
    case 'SET_OPERATION':
      if (state.operation === action.op) return state;
      return { ...state, operation: action.op };
    case 'END_DRAG':
      return initialState;
    default:
      return state;
  }
};

/** macOS drag semantics: Option = copy, ⌘+Option = symbolic link, none = move. */
const operationFromModifiers = (altKey: boolean, metaKey: boolean): 'copy' | 'move' | 'link' => {
  if (altKey && metaKey) return 'link';
  if (altKey) return 'copy';
  return 'move';
};

/** Whether a hovered drop target accepts the current drag. */
const isDropTargetValid = (
  action: string | null,
  draggedPaths: string[],
  targetPath: string,
  isFolder: boolean,
): boolean => {
  if (draggedPaths.length === 0) return true;
  // Special targets (trash, bookmark-add) accept any drop
  if (action) return true;
  return validateDrop(draggedPaths, targetPath, isFolder).valid;
};

// ── Context ──────────────────────────────────────────────────────────────────

const DragDropContext = createContext<DragDropContextValue | null>(null);

export const DragDropProvider = ({ children }: { children: React.ReactNode }) => {
  const [dragState, dispatch] = useReducer(dragReducer, initialState);
  const stateRef = useRef(dragState);
  stateRef.current = dragState;

  // Conflict dialog + progress toast state (rendered by the provider below)
  const [conflictRequest, setConflictRequest] = useState<ConflictRequest | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<ActiveTransfer | null>(null);

  const runTransfer = useCallback(
    async (
      sources: string[],
      targetDir: string,
      mode: 'copy' | 'move',
      conflicts: ConflictInfo[] | null,
      policies: Map<string, ConflictPolicy> | null,
    ) => {
      try {
        const plan: TransferPlan = conflicts
          ? await planTransfer(
              sources,
              targetDir,
              conflicts,
              (source) => policies?.get(source) ?? 'keepBoth',
              (name) => TauriAPI.getRenameDest(targetDir, name),
            )
          : {
              items: sources.map((source) => ({
                source,
                dest: buildDestinationPath(source, targetDir),
              })),
              skippedCount: 0,
            };

        const ids: string[] = [];
        for (const item of plan.items) {
          if (item.merge) {
            await TauriAPI.copyDirMerge(item.source, item.dest);
          } else if (mode === 'copy') {
            ids.push(
              await TauriAPI.copyWithProgress(item.source, item.dest, item.overwrite === true),
            );
          } else {
            ids.push(
              await TauriAPI.moveWithProgress(item.source, item.dest, item.overwrite === true),
            );
          }
        }

        const count = plan.items.length;
        if (count === 0) {
          window.dispatchEvent(new CustomEvent('files-changed'));
          return;
        }
        setActiveTransfer({
          ids,
          itemCount: count,
          mode,
          destDir: targetDir,
          silent: count <= 10,
        });
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent('drag-drop-error', { detail: { message: String(error) } }),
        );
        window.dispatchEvent(new CustomEvent('files-changed'));
      }
    },
    [],
  );

  // Track the currently highlighted element for cleanup
  const highlightedRef = useRef<HTMLElement | null>(null);
  // Track the last hovered target path to avoid redundant DOM updates
  const lastHoverPathRef = useRef<string | null>(null);
  // Spring-loaded folder timer: fires navigation if hovering a folder for 500ms
  const springTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cursor position stored in a ref (not state) — only the overlay reads it
  // via requestAnimationFrame, avoiding React re-renders on every mouse move.
  const cursorRef = useRef({ x: 0, y: 0 });
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number>(0);

  const clearHighlight = useCallback(() => {
    if (highlightedRef.current) {
      highlightedRef.current.removeAttribute('data-drop-hover');
      highlightedRef.current.removeAttribute('data-drop-invalid');
      highlightedRef.current.classList.remove('xp-drop-folder-highlight');
      highlightedRef.current = null;
    }
    lastHoverPathRef.current = null;
    // Cancel any pending spring-load navigation
    if (springTimerRef.current !== null) {
      clearTimeout(springTimerRef.current);
      springTimerRef.current = null;
    }
  }, []);

  const findDropTarget = useCallback(
    (
      x: number,
      y: number,
    ): { element: HTMLElement; path: string; action: string | null } | null => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const target = (el as HTMLElement).closest('[data-drop-target]') as HTMLElement | null;
      if (!target) return null;
      const path = target.getAttribute('data-drop-target');
      if (path === null) return null;
      return { element: target, path, action: target.getAttribute('data-drop-action') };
    },
    [],
  );

  // Listen for Tauri drag-drop events (handles BOTH external file drops AND
  // internal startDrag loops). In web mode, native DnD is not available.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;

    (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;

          if (payload.type === 'enter') {
            // Files entering the window (from OS or from our own startDrag)
            const paths = (payload as { type: string; paths: string[] }).paths;
            if (paths?.length > 0) {
              if (!stateRef.current.isDragging) {
                dispatch({ type: 'START_DRAG', paths, source: 'external', op: 'copy' });
              }
            }
          } else if (payload.type === 'over') {
            // Hovering — update cursor position and find drop target
            const pos = (payload as { type: string; position: { x: number; y: number } }).position;
            if (pos) {
              const scale = window.devicePixelRatio || 1;
              const x = pos.x / scale;
              const y = pos.y / scale;

              // Update cursor ref (no React re-render)
              cursorRef.current.x = x;
              cursorRef.current.y = y;

              // Move overlay via rAF (GPU-accelerated transform)
              cancelAnimationFrame(rafIdRef.current);
              rafIdRef.current = requestAnimationFrame(() => {
                if (overlayRef.current) {
                  overlayRef.current.style.transform = `translate(${x + 16}px, ${y + 16}px)`;
                }
              });

              // Find drop target and update highlight only if target changed
              const target = findDropTarget(x, y);
              const targetPath = target?.path ?? null;

              if (targetPath !== lastHoverPathRef.current) {
                clearHighlight();

                if (target) {
                  const { draggedPaths } = stateRef.current;
                  const isFolder =
                    target.element.getAttribute('data-is-folder') === 'true' ||
                    target.element.closest('[data-is-folder="true"]') !== null;
                  const valid = isDropTargetValid(
                    target.action,
                    draggedPaths,
                    target.path,
                    isFolder,
                  );
                  if (valid) {
                    target.element.setAttribute('data-drop-hover', 'true');
                    target.element.classList.add('xp-drop-folder-highlight');

                    // Spring-loaded folder: if hovering a valid folder drop
                    // target for 500ms, navigate into it automatically.
                    if (isFolder) {
                      springTimerRef.current = setTimeout(() => {
                        springTimerRef.current = null;
                        window.dispatchEvent(
                          new CustomEvent('spring-load-folder', {
                            detail: { path: target.path },
                          }),
                        );
                      }, 500);
                    }
                  } else {
                    target.element.setAttribute('data-drop-invalid', 'true');
                  }
                  highlightedRef.current = target.element;
                }
                lastHoverPathRef.current = targetPath;
                dispatch({ type: 'SET_HOVER', targetPath });
              }
            }
          } else if (payload.type === 'drop') {
            // Files dropped
            const { paths, position } = payload as {
              type: string;
              paths: string[];
              position: { x: number; y: number };
            };
            clearHighlight();

            if (paths?.length > 0 && position) {
              const scale = window.devicePixelRatio || 1;
              const x = position.x / scale;
              const y = position.y / scale;
              const target = findDropTarget(x, y);

              if (target) {
                const isFolder =
                  target.element.getAttribute('data-is-folder') === 'true' ||
                  target.element.closest('[data-is-folder="true"]') !== null;
                if (isDropTargetValid(target.action, paths, target.path, isFolder)) {
                  if (target.action === 'bookmark-add') {
                    (async () => {
                      try {
                        for (const sourcePath of paths) {
                          const name = sourcePath.split(/[/\\]/).pop() || sourcePath;
                          await TauriAPI.addBookmark(sourcePath, name);
                        }
                        window.dispatchEvent(new CustomEvent('bookmarks-changed'));
                      } catch (error) {
                        window.dispatchEvent(
                          new CustomEvent('drag-drop-error', {
                            detail: { message: String(error) },
                          }),
                        );
                      }
                    })();
                  } else if (target.action === 'trash') {
                    (async () => {
                      try {
                        for (const sourcePath of paths) {
                          await TauriAPI.moveToTrash(sourcePath);
                        }
                        window.dispatchEvent(new CustomEvent('files-changed'));
                      } catch (error) {
                        window.dispatchEvent(
                          new CustomEvent('drag-drop-error', {
                            detail: { message: String(error) },
                          }),
                        );
                      }
                    })();
                  } else {
                    const op = stateRef.current.operation;
                    const isExternal = stateRef.current.dragSource === 'external';
                    (async () => {
                      try {
                        // ⌘+Option: create a symbolic link at the target
                        if (op === 'link') {
                          for (const sourcePath of paths) {
                            const dest = buildDestinationPath(sourcePath, target.path);
                            await TauriAPI.createSymlink(sourcePath, dest);
                          }
                          window.dispatchEvent(new CustomEvent('files-changed'));
                          return;
                        }
                        // Default is move; copy on Option, on external drags, or when
                        // source and target live on different volumes (macOS convention).
                        let mode: 'copy' | 'move' = op === 'copy' || isExternal ? 'copy' : 'move';
                        if (mode === 'move') {
                          try {
                            const sameVol = await TauriAPI.sameVolume(paths[0], target.path);
                            if (!sameVol) mode = 'copy';
                          } catch {
                            // Volume detection failed; keep the default move semantics
                          }
                        }
                        // Ask about name conflicts before transferring
                        const conflicts = await TauriAPI.checkConflicts(paths, target.path);
                        if (conflicts.length > 0) {
                          setConflictRequest({
                            sources: paths,
                            targetDir: target.path,
                            conflicts,
                            mode,
                          });
                          return;
                        }
                        void runTransfer(paths, target.path, mode, null, null);
                      } catch (error) {
                        window.dispatchEvent(
                          new CustomEvent('drag-drop-error', {
                            detail: { message: String(error) },
                          }),
                        );
                      }
                    })();
                  }
                }
              }
            }
            dispatch({ type: 'END_DRAG' });
          } else if (payload.type === 'leave') {
            clearHighlight();
            // Only end drag if it was external — internal startDrag returns to our window
            if (stateRef.current.dragSource === 'external') {
              dispatch({ type: 'END_DRAG' });
            }
          }
        })
        .then((fn) => {
          unlisten = fn;
        });
    })();

    return () => {
      unlisten?.();
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [findDropTarget, clearHighlight, runTransfer]);

  // Listen for Option/⌘ during drag to switch move / copy / link (macOS semantics)
  useEffect(() => {
    const handleModifierChange = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' && e.key !== 'Meta') return;
      if (!stateRef.current.isDragging || stateRef.current.dragSource !== 'internal') return;
      dispatch({ type: 'SET_OPERATION', op: operationFromModifiers(e.altKey, e.metaKey) });
    };
    window.addEventListener('keydown', handleModifierChange);
    window.addEventListener('keyup', handleModifierChange);
    return () => {
      window.removeEventListener('keydown', handleModifierChange);
      window.removeEventListener('keyup', handleModifierChange);
    };
  }, []);

  // Cmd+Z undoes the last drag transfer while its toast is still visible
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null): boolean =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      if (isEditableTarget(document.activeElement)) return;
      void undoLastTransfer().then((ok) => {
        if (ok) window.dispatchEvent(new CustomEvent('files-changed'));
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // HTML5 drag events for non-file content (text / URLs / image blobs from
  // browsers). Real file drags stay on the native onDragDropEvent path.
  useEffect(() => {
    if (!isTauri()) return;

    const isContentDrag = (dt: DataTransfer): boolean => {
      const types = Array.from(dt.types).map((t) => t.toLowerCase());
      if (
        types.some((t) =>
          ['text/plain', 'text/uri-list', 'text/html', 'public.utf8-plain-text'].includes(t),
        )
      ) {
        return true;
      }
      const file = dt.files[0];
      return !!file && file.type.startsWith('image/');
    };

    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer || !isContentDrag(e.dataTransfer)) return;
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      if (!e.dataTransfer || !isContentDrag(e.dataTransfer)) return;
      const dt = e.dataTransfer;
      const target = findDropTarget(e.clientX, e.clientY);
      if (!target || target.action) return; // folder targets only
      const targetDir = target.path;

      void (async () => {
        try {
          const plan = await parseBrowserDrop(dt);
          if (!plan) return;
          if (plan.kind === 'url') {
            await TauriAPI.createFileWithContent(
              uniqueDroppedName(targetDir, 'dropped-url', 'webloc'),
              plan.content,
            );
          } else if (plan.kind === 'text') {
            await TauriAPI.createFileWithContent(
              uniqueDroppedName(targetDir, 'dropped-text', 'txt'),
              plan.content,
            );
          } else {
            await TauriAPI.writeBinaryFile(
              uniqueDroppedName(targetDir, 'dropped-image', plan.ext),
              plan.bytes,
            );
          }
          window.dispatchEvent(new CustomEvent('files-changed'));
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent('drag-drop-error', { detail: { message: String(error) } }),
          );
        }
      })();
      e.preventDefault();
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [findDropTarget]);

  const registerDropTarget = useCallback((_path: string, _element: HTMLElement) => {
    return () => {};
  }, []);

  const startInternalDrag = useCallback((paths: string[]) => {
    dispatch({ type: 'START_DRAG', paths, source: 'internal', op: 'move' });
  }, []);

  const endInternalDrag = useCallback(() => {
    dispatch({ type: 'END_DRAG' });
  }, []);

  return (
    <DragDropContext.Provider
      value={{ dragState, registerDropTarget, startInternalDrag, endInternalDrag }}
    >
      {children}
      {dragState.isDragging && <DragOverlay state={dragState} overlayRef={overlayRef} />}
      {conflictRequest && (
        <ConflictResolutionDialog
          conflicts={conflictRequest.conflicts}
          onCancel={() => setConflictRequest(null)}
          onResolve={(policies) => {
            const request = conflictRequest;
            setConflictRequest(null);
            void runTransfer(
              request.sources,
              request.targetDir,
              request.mode,
              request.conflicts,
              policies,
            );
          }}
        />
      )}
      {activeTransfer && (
        <TransferProgressToast
          ids={activeTransfer.ids}
          itemCount={activeTransfer.itemCount}
          mode={activeTransfer.mode}
          destDir={activeTransfer.destDir}
          silent={activeTransfer.silent}
          onDismiss={() => setActiveTransfer(null)}
        />
      )}
    </DragDropContext.Provider>
  );
};

// ── DragOverlay ──────────────────────────────────────────────────────────────

const getOverlayAppearance = (
  op: DragState['operation'],
  t: ReturnType<typeof useTranslation>['t'],
) => {
  if (op === 'link') {
    return {
      symbol: '\u2197',
      label: t('dragOverlay.link'),
      accent: 'var(--xp-yellow, #e2b340)',
      accentBg: 'rgba(226, 179, 64, 0.15)',
    };
  }
  if (op === 'copy') {
    return {
      symbol: '+',
      label: t('dragOverlay.copy'),
      accent: 'var(--xp-green)',
      accentBg: 'rgba(52, 211, 153, 0.15)',
    };
  }
  return {
    symbol: '\u2192',
    label: t('dragOverlay.move'),
    accent: 'var(--xp-blue)',
    accentBg: 'rgba(99, 102, 241, 0.15)',
  };
};

/** Floating badge near the cursor showing copy/move/link operation + file count. */
const DragOverlay = ({
  state,
  overlayRef,
}: {
  state: DragState;
  overlayRef: React.MutableRefObject<HTMLDivElement | null>;
}) => {
  const { t } = useTranslation();
  const { draggedPaths, operation } = state;
  const count = draggedPaths.length;
  if (count === 0) return null;

  const { symbol, label: opLabel, accent, accentBg } = getOverlayAppearance(operation, t);
  const fileName = draggedPaths[0]?.split(/[/\\]/).pop() || '';
  const label = count > 1 ? t('dragOverlay.files', { count }) : fileName;

  return createPortal(
    <div
      ref={overlayRef}
      className="xp-drag-overlay"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        willChange: 'transform',
        pointerEvents: 'none',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 500,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        background: accentBg,
        border: `1px solid ${accent}`,
        color: accent,
        boxShadow: `0 2px 12px ${accentBg}`,
      }}
    >
      <span style={{ fontSize: '14px' }}>{symbol}</span>
      <span>{opLabel}</span>
      <span
        style={{
          opacity: 0.7,
          fontSize: '11px',
          maxWidth: '140px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
    </div>,
    document.body,
  );
};

export const useDragDropContext = (): DragDropContextValue => {
  const ctx = useContext(DragDropContext);
  if (!ctx) throw new Error('useDragDropContext must be used within DragDropProvider');
  return ctx;
};
