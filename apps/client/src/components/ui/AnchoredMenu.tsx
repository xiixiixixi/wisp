import { useLayoutEffect, useRef, useState, type HTMLAttributes, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface AnchoredMenuProps extends HTMLAttributes<HTMLDivElement> {
  anchorRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
}

/** Escape clipped/resizable panes while keeping the menu next to its control. */
export const AnchoredMenu = ({ anchorRef, menuRef, style, ...props }: AnchoredMenuProps) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 320 });

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      const menu = nodeRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect();
      const gutter = 8;
      const below = window.innerHeight - rect.bottom - gutter * 2;
      const above = rect.top - gutter * 2;
      const openAbove = below < Math.min(menu.scrollHeight, 200) && above > below;
      const maxHeight = Math.max(40, openAbove ? above : below);
      const height = Math.min(menu.scrollHeight, maxHeight);
      setPosition({
        left: Math.max(gutter, Math.min(rect.left, window.innerWidth - menu.offsetWidth - gutter)),
        top: Math.max(gutter, openAbove ? rect.top - height - gutter : rect.bottom + gutter),
        maxHeight,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (nodeRef.current) observer.observe(nodeRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      {...props}
      ref={(node) => {
        nodeRef.current = node;
        menuRef.current = node;
      }}
      style={{
        ...style,
        position: 'fixed',
        ...position,
        maxWidth: 'calc(100vw - 16px)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        zIndex: 100,
      }}
    />,
    document.body,
  );
};
