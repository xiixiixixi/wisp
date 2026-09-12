import React, { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  /** Extra classes for layout-specific positioning. */
  className?: string;
}

const ResizeHandle = ({ direction, onResize, onResizeEnd, className = '' }: ResizeHandleProps) => {
  const isDragging = useRef(false);
  const lastPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
        const delta = currentPos - lastPos.current;
        lastPos.current = currentPos;
        if (delta !== 0) onResize(delta);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onResizeEnd?.();
      };

      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [direction, onResize, onResizeEnd],
  );

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`wisp-resize-handle group relative flex-shrink-0 ${
        isHorizontal
          ? 'wisp-resize-handle-horizontal w-3 cursor-col-resize'
          : 'wisp-resize-handle-vertical h-3 cursor-row-resize'
      } ${className}`}
    >
      {/* Keep the grab zone while revealing its rail only during interaction. */}
      <span
        aria-hidden="true"
        className={`wisp-resize-indicator pointer-events-none absolute bg-[var(--ds-link)] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-70 group-active:opacity-100 motion-reduce:transition-none ${
          isHorizontal
            ? 'bottom-0 left-1/2 top-0 w-px -translate-x-1/2'
            : 'left-0 right-0 top-1/2 h-px -translate-y-1/2'
        }`}
      />
    </div>
  );
};

export default ResizeHandle;
