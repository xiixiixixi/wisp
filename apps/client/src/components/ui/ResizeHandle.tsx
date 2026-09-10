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
      {/* Visual 1px rail centered in a 12px grab zone — the tiny w-1 strip
          was nearly impossible to hit with a real mouse. */}
      <span
        className={`absolute transition-colors group-hover:bg-xp-blue/70 group-active:bg-xp-blue ${
          isHorizontal
            ? 'top-0 bottom-0 left-1/2 w-px -translate-x-1/2'
            : 'left-0 right-0 top-1/2 h-px -translate-y-1/2'
        } bg-xp-border`}
      />
    </div>
  );
};

export default ResizeHandle;
