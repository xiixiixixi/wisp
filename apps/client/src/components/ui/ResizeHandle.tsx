import React, { useCallback, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  className?: string;
  ariaLabel?: string;
  value?: number;
  min?: number;
  max?: number;
}

const ResizeHandle = ({
  direction,
  onResize,
  onResizeEnd,
  className = '',
  ariaLabel,
  value,
  min,
  max,
}: ResizeHandleProps) => {
  const { t } = useTranslation();
  const hintId = useId();
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const endRef = useRef(onResizeEnd);
  const resizeRef = useRef(onResize);
  endRef.current = onResizeEnd;
  resizeRef.current = onResize;
  useEffect(() => () => cleanupDragRef.current?.(), []);
  const isHorizontal = direction === 'horizontal';
  const label = ariaLabel ?? t(isHorizontal ? 'sidebar.resizeWidth' : 'sidebar.resizeHeight');
  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      cleanupDragRef.current?.();
      let last = direction === 'horizontal' ? event.clientX : event.clientY;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      const handleMove = (move: MouseEvent) => {
        const next = direction === 'horizontal' ? move.clientX : move.clientY;
        const delta = next - last;
        last = next;
        if (delta !== 0) resizeRef.current(delta);
      };
      const cleanup = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', finish);
        window.removeEventListener('blur', finish);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        cleanupDragRef.current = null;
      };
      const finish = () => {
        cleanup();
        endRef.current?.();
      };
      cleanupDragRef.current = cleanup;
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', finish);
      window.addEventListener('blur', finish);
    },
    [direction],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-describedby={hintId}
      title={`${label} · ${t('sidebar.resizeHint')}`}
      onMouseDown={handleMouseDown}
      onKeyDown={(event) => {
        const backward = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
        const forward = isHorizontal ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== backward && event.key !== forward) return;
        event.preventDefault();
        resizeRef.current((event.key === backward ? -1 : 1) * (event.shiftKey ? 32 : 8));
      }}
      onKeyUp={(event) => {
        if (
          (isHorizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']).includes(
            event.key,
          )
        ) {
          endRef.current?.();
        }
      }}
      className={`wisp-resize-handle group relative flex-shrink-0 ${isHorizontal ? 'wisp-resize-handle-horizontal w-3 cursor-col-resize' : 'wisp-resize-handle-vertical h-3 cursor-row-resize'} ${className}`}
    >
      <span id={hintId} className="sr-only">
        {t('sidebar.resizeHint')}
      </span>
      <span
        aria-hidden="true"
        className={`wisp-resize-grip pointer-events-none absolute rounded-full bg-[var(--ds-label-tertiary)] ${isHorizontal ? 'left-1/2 top-1/2 h-7 w-[3px] -translate-x-1/2 -translate-y-1/2' : 'left-1/2 top-1/2 h-[3px] w-7 -translate-x-1/2 -translate-y-1/2'}`}
      />
    </div>
  );
};
export default ResizeHandle;
