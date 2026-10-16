import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** 输入框菜单挂在页面顶层，避免被窄侧栏裁切；所有菜单共用关闭和键盘行为。 */
const PiComposerMenu = ({
  anchorRef,
  label,
  onClose,
  children,
  role = 'menu',
  focusOnOpen = true,
  testId,
  id,
  width = 280,
  focusKey,
  onBack,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
  role?: 'menu' | 'listbox';
  focusOnOpen?: boolean;
  testId?: string;
  id?: string;
  width?: number;
  focusKey?: string;
  onBack?: () => void;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 360 });
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const trigger = anchor.getBoundingClientRect();
      // 贴近当前入口展开；菜单自身的尺寸观察会在内部换页后重新定位。
      const gutter = 8;
      const above = Math.max(0, trigger.top - gutter * 2);
      const below = Math.max(0, window.innerHeight - trigger.bottom - gutter * 2);
      const openAbove = above >= Math.min(menu.scrollHeight, 200) || above >= below;
      const maxHeight = Math.min(360, Math.max(40, openAbove ? above : below));
      const height = Math.min(menu.scrollHeight, maxHeight);
      setPosition({
        left: Math.max(
          gutter,
          Math.min(trigger.left, window.innerWidth - menu.offsetWidth - gutter),
        ),
        top: Math.max(gutter, openAbove ? trigger.top - height - gutter : trigger.bottom + gutter),
        maxHeight,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchorRef.current) observer.observe(anchorRef.current);
    const composer = anchorRef.current?.closest('.pi-composer-box');
    if (composer) observer.observe(composer);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const outside = (event: Event) => {
      if (
        !anchor.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        closeRef.current();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      if (!focusOnOpen) anchor.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      else anchor.querySelector<HTMLButtonElement>('button')?.focus();
    };
    if (focusOnOpen) {
      const selected = menuRef.current?.querySelector<HTMLElement>(
        '[aria-checked="true"], [aria-selected="true"]',
      );
      const first = menuRef.current?.querySelector<HTMLElement>(
        '[role^="menuitem"]:not(:disabled), [role="option"]:not(:disabled)',
      );
      (selected ?? first)?.focus({ preventScroll: true });
      selected?.scrollIntoView?.({ block: 'nearest' });
    }
    document.addEventListener('mousedown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [anchorRef, focusOnOpen, focusKey]);

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role={role}
      aria-label={label}
      data-testid={testId}
      className="wisp-popover-menu pi-composer-menu"
      style={{ position: 'fixed', zIndex: 100, width, ...position }}
      onClick={(event) => {
        const item = (event.target as HTMLElement).closest('[role^="menuitem"], [role="option"]');
        if (!item || item.hasAttribute('data-menu-keep-open')) return;
        if (document.activeElement && !menuRef.current?.contains(document.activeElement)) return;
        if (!focusOnOpen) {
          anchorRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
        } else {
          anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' && onBack) {
          event.preventDefault();
          onBack();
          return;
        }
        if (
          event.key === 'ArrowRight' &&
          (event.target as HTMLElement).hasAttribute('data-menu-keep-open')
        ) {
          event.preventDefault();
          (event.target as HTMLElement).click();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;
        if (event.key === 'Tab') {
          anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
          onClose();
          return;
        }
        const items = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role^="menuitem"]:not(:disabled), [role="option"]:not(:disabled)',
          ) || []),
        ];
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        let index = (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        if (event.key === 'Home') index = 0;
        if (event.key === 'End') index = items.length - 1;
        items[index]?.focus();
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

export default PiComposerMenu;
