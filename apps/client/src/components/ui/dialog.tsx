import React, { useEffect, useRef, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// Closed disclosure content remains mounted but cannot receive keyboard focus.
const isAvailableFocusTarget = (element: HTMLElement) => {
  if (element.tabIndex < 0 || element.closest('[hidden], [inert], [aria-hidden="true"]')) {
    return false;
  }
  let ancestor = element.parentElement;
  while (ancestor) {
    if (ancestor.tagName === 'DETAILS' && !ancestor.hasAttribute('open')) {
      const summary = Array.from(ancestor.children).find((child) => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
    ancestor = ancestor.parentElement;
  }
  return true;
};

interface DialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  /** Explicit id to link aria-labelledby to a DialogTitle. Auto-generated if omitted. */
  titleId?: string;
  /** When true, Escape key and backdrop click will not close the dialog. */
  preventClose?: boolean;
  /** Whether clicking the backdrop closes the dialog. Default true. */
  closeOnBackdropClick?: boolean;
  /** Width belongs to the actual modal, not an inner content wrapper. */
  maxWidth?: React.CSSProperties['maxWidth'];
}

// React context so DialogTitle can read the resolved titleId without extra props.
const DialogContext = React.createContext<{ titleId: string } | null>(null);

export const Dialog = ({
  open,
  onOpenChange,
  children,
  titleId: titleIdProp,
  preventClose = false,
  closeOnBackdropClick = true,
  maxWidth,
}: DialogProps) => {
  const autoId = useId();
  const titleId = titleIdProp ?? `dialog-title-${autoId}`;

  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // ---- helpers ----
  const requestClose = useCallback(() => {
    if (!preventClose) {
      onOpenChange?.(false);
    }
  }, [preventClose, onOpenChange]);

  // ---- focus trap & auto-focus ----
  useEffect(() => {
    if (!open) return;

    // Save the element that was focused before the dialog opened.
    previousFocusRef.current = document.activeElement;

    // Small delay so the dialog DOM is painted before we query focusable elements.
    const raf = requestAnimationFrame(() => {
      const container = dialogRef.current;
      if (!container) return;

      // Auto-focus: prefer [data-autofocus], then first focusable, then the container itself.
      const autofocusEl = Array.from(
        container.querySelectorAll<HTMLElement>('[data-autofocus]'),
      ).find(isAvailableFocusTarget);
      if (autofocusEl) {
        autofocusEl.focus();
      } else {
        const first = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(
          isAvailableFocusTarget,
        );
        if (first) {
          first.focus();
        } else {
          container.focus();
        }
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      // Cleanup also runs when the owner conditionally unmounts the dialog.
      const previous = previousFocusRef.current;
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, [open]);

  // ---- keyboard handling (Escape + Tab trap) ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // A nested portal (for example Select) owns its own Escape/Tab events.
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
        return;
      }

      if (e.key === 'Tab') {
        const container = dialogRef.current;
        if (!container) return;

        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter(isAvailableFocusTarget);
        if (focusable.length === 0) {
          e.preventDefault();
          container.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === container) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [requestClose],
  );

  const handleBackdropClick = useCallback(() => {
    if (closeOnBackdropClick) {
      requestClose();
    }
  }, [closeOnBackdropClick, requestClose]);

  if (!open) return null;

  return createPortal(
    <DialogContext.Provider value={{ titleId }}>
      <div
        className="wisp-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/20"
        onClick={handleBackdropClick}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="elevated-glass mx-4 max-h-[min(90dvh,calc(100dvh-40px))] w-full max-w-4xl overflow-y-auto overscroll-contain rounded-2xl border border-[var(--ds-separator)] bg-xp-popover text-[13px] text-[var(--ds-label-primary)] shadow-[var(--xp-shadow-popover)]"
          style={{ outline: 'none', maxWidth }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body,
  );
};

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
}

export const DialogContent = ({ children, className = '' }: DialogContentProps) => {
  return <div className={cn('p-5', className)}>{children}</div>;
};

interface DialogHeaderProps {
  children: React.ReactNode;
}

export const DialogHeader = ({ children }: DialogHeaderProps) => {
  return <div className="mb-5 space-y-1.5">{children}</div>;
};

interface DialogTitleProps {
  children: React.ReactNode;
  className?: string;
  /** Override the auto-generated id used for aria-labelledby linking. */
  id?: string;
}

export const DialogTitle = ({ children, className = '', id: idProp }: DialogTitleProps) => {
  const ctx = React.useContext(DialogContext);
  const resolvedId = idProp ?? ctx?.titleId;

  return (
    <h2
      id={resolvedId}
      className={cn(
        'text-[17px] font-semibold leading-[22px] text-[var(--ds-label-primary)]',
        className,
      )}
    >
      {children}
    </h2>
  );
};

interface DialogDescriptionProps {
  children: React.ReactNode;
}

export const DialogDescription = ({ children }: DialogDescriptionProps) => {
  return <p className="text-[13px] leading-[1.4] text-[var(--ds-label-secondary)]">{children}</p>;
};

interface DialogTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export const DialogTrigger = ({ children }: DialogTriggerProps) => {
  return <>{children}</>;
};

interface DialogFooterProps {
  children: React.ReactNode;
}

export const DialogFooter = ({ children }: DialogFooterProps) => {
  return <div className="flex flex-wrap justify-end gap-2 pt-5">{children}</div>;
};
