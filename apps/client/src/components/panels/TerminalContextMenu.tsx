import { useEffect, useLayoutEffect, useRef } from 'react';
import { AnchoredMenu } from '@/components/ui/AnchoredMenu';

export interface TerminalContextMenuItem {
  /** Stable id for keying and telemetry. */
  key: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface TerminalContextMenuProps {
  /** Viewport point to anchor at (the right-click position). */
  point: { x: number; y: number };
  items: TerminalContextMenuItem[];
  menuLabel: string;
  onDismiss: () => void;
}

/**
 * Right-click menu for the terminal surface. Anchored at the cursor via a
 * zero-size fixed-position node, so AnchoredMenu needs no changes. Item
 * driven so the full Ghostty-style menu (#32) can extend it later.
 */
const TerminalContextMenu = ({ point, items, menuLabel, onDismiss }: TerminalContextMenuProps) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first enabled item when the menu opens.
  useLayoutEffect(() => {
    const enabled = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    enabled?.[0]?.focus();
  }, []);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onDismiss();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }
      // Roving focus across items, mirroring the terminal actions menu.
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const menuItems = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
          [],
      );
      if (!menuItems.length) return;
      event.preventDefault();
      const current = menuItems.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        (current + (event.key === 'ArrowUp' ? -1 : 1) + menuItems.length) % menuItems.length;
      menuItems[next]?.focus();
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onDismiss]);

  return (
    <>
      <div
        ref={anchorRef}
        aria-hidden="true"
        style={{ position: 'fixed', left: point.x, top: point.y, width: 0, height: 0 }}
      />
      <AnchoredMenu
        anchorRef={anchorRef}
        menuRef={menuRef}
        role="menu"
        aria-label={menuLabel}
        className="wisp-terminal-menu"
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={item.disabled}
            onClick={() => {
              onDismiss();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </AnchoredMenu>
    </>
  );
};

export default TerminalContextMenu;
