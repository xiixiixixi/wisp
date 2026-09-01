import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast, toast, TOAST_AUTO_DISMISS_DELAY } from '@/hooks/use-toast';

interface ToastProps {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: 'default' | 'destructive';
  presentation?: 'toast' | 'dialog';
  open?: boolean;
  /** Show the shrinking countdown bar (matches the auto-dismiss timer). */
  showCountdown?: boolean;
  onClose?: () => void;
}

const Toast = ({
  id,
  title,
  description,
  variant = 'default',
  presentation = 'toast',
  open = true,
  showCountdown = false,
  onClose,
}: ToastProps) => {
  const { t } = useTranslation();
  const titleId = title ? `toast-${id}-title` : undefined;
  const baseClasses =
    'relative flex w-full overflow-hidden rounded-[2px] border shadow-[var(--xp-shadow-popover)] transition-all duration-200 ease-in-out transform';
  const variantClasses =
    variant === 'destructive'
      ? 'bg-xp-popover border-xp-red/50 text-xp-text'
      : 'bg-xp-popover border-xp-border text-xp-text';
  const visibilityClasses = open
    ? 'opacity-100 scale-100 translate-y-0'
    : 'opacity-0 scale-95 translate-y-1 pointer-events-none';
  let ariaLive: 'assertive' | 'polite' | undefined;
  if (presentation !== 'dialog') {
    ariaLive = variant === 'destructive' ? 'assertive' : 'polite';
  }

  return (
    <div
      className={`${baseClasses} ${variantClasses} ${visibilityClasses}`}
      role={presentation === 'dialog' ? 'dialog' : 'status'}
      aria-modal={presentation === 'dialog' ? true : undefined}
      aria-labelledby={titleId}
      aria-live={ariaLive}
    >
      <div className={presentation === 'dialog' ? 'flex-1 p-5 pr-12' : 'flex-1 p-4'}>
        {title && (
          <div
            id={titleId}
            className={
              presentation === 'dialog'
                ? 'mb-1.5 text-base font-medium'
                : 'mb-1 text-sm font-medium'
            }
          >
            {title}
          </div>
        )}
        {description && <div className="text-xs opacity-90">{description}</div>}
      </div>

      <button
        onClick={onClose}
        className={
          presentation === 'dialog'
            ? 'absolute right-3 top-3 rounded-[2px] p-1.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text'
            : 'flex-shrink-0 px-3 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text'
        }
        aria-label={t('common.close')}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      {presentation !== 'dialog' && showCountdown && (
        <div
          className={`absolute bottom-0 left-0 h-px ${
            variant === 'destructive' ? 'bg-xp-red' : 'bg-xp-lime'
          }`}
          style={{ animation: `toast-countdown ${TOAST_AUTO_DISMISS_DELAY}ms linear forwards` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export const Toaster = () => {
  const { toasts, dismiss, remove } = useToast();
  const dialogRef = React.useRef<HTMLDivElement>(null);

  const closeToast = React.useCallback(
    (toastId: string, onOpenChange?: (open: boolean) => void) => {
      if (onOpenChange) onOpenChange(false);
      else dismiss(toastId);
      setTimeout(() => remove(toastId), 150);
    },
    [dismiss, remove],
  );

  const dialogToast = toasts.find((item) => item.presentation === 'dialog' && item.open !== false);
  const notifications = toasts.filter((item) => item.presentation !== 'dialog');

  React.useEffect(() => {
    if (!dialogToast) return;
    const previousFocus = dialogToast.returnFocus ?? (document.activeElement as HTMLElement | null);
    const activeDialog = dialogToast;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeToast(activeDialog.id, activeDialog.onOpenChange);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected && previousFocus !== document.body) {
        previousFocus.focus();
      } else {
        document.querySelector<HTMLElement>('[data-command-palette-trigger]')?.focus();
      }
    };
  }, [dialogToast, closeToast]);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col-reverse space-y-2 space-y-reverse">
        {notifications.map((item) => (
          <div key={item.id} className="relative">
            <Toast
              id={item.id}
              title={item.title}
              description={item.description}
              variant={item.variant}
              open={item.open !== false}
              showCountdown={item.autoDismiss !== false}
              onClose={() => closeToast(item.id, item.onOpenChange)}
            />
          </div>
        ))}
      </div>

      {dialogToast && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeToast(dialogToast.id, dialogToast.onOpenChange);
            }
          }}
        >
          <div
            ref={dialogRef}
            className="w-full max-w-md"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Toast
              id={dialogToast.id}
              title={dialogToast.title}
              description={dialogToast.description}
              variant={dialogToast.variant}
              presentation="dialog"
              open={dialogToast.open !== false}
              onClose={() => closeToast(dialogToast.id, dialogToast.onOpenChange)}
            />
          </div>
        </div>
      )}
    </>
  );
};

// Extended toast components for confirmation and input
interface ConfirmationToastProps {
  title: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
}

const ConfirmationToast = ({
  title,
  description,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
}: ConfirmationToastProps) => {
  return (
    <div className="relative flex w-full overflow-hidden rounded-[2px] border border-xp-border bg-xp-popover text-xp-text shadow-[var(--xp-shadow-popover)]">
      <div className="flex-1 p-4">
        <div className="mb-1 text-sm font-medium">{title}</div>
        {description && <div className="mb-3 text-xs opacity-90">{description}</div>}
        <div className="flex space-x-2">
          <button
            onClick={onConfirm}
            className="rounded-[2px] bg-xp-red px-3 py-1 text-xs text-xp-on-accent transition-opacity hover:opacity-85"
          >
            {confirmText}
          </button>
          <button
            onClick={onCancel}
            className="rounded-[2px] border border-xp-border bg-transparent px-3 py-1 text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
          >
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  );
};

interface InputToastProps {
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  selectNameWithoutExtension?: boolean;
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  submitText?: string;
  cancelText?: string;
}

const InputToast = ({
  title,
  description,
  placeholder = '',
  onSubmit,
  onCancel,
  submitText = 'Create',
  cancelText = 'Cancel',
}: InputToastProps) => {
  const [value, setValue] = React.useState('');

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="relative flex w-full overflow-hidden rounded-[2px] border border-xp-border bg-xp-popover text-xp-text shadow-[var(--xp-shadow-popover)]">
      <div className="flex-1 p-4">
        <div className="mb-1 text-sm font-medium">{title}</div>
        {description && <div className="mb-3 text-xs opacity-90">{description}</div>}
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={placeholder}
          className="mb-3 w-full rounded-[2px] border border-xp-border bg-xp-surface-light px-3 py-1.5 text-sm text-xp-text placeholder:text-xp-text-muted focus:border-xp-text-secondary focus:outline-none"
          autoFocus
        />
        <div className="flex space-x-2">
          <button
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="rounded-[2px] bg-xp-accent px-3 py-1 text-xs text-xp-on-accent transition-colors hover:bg-xp-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitText}
          </button>
          <button
            onClick={onCancel}
            className="rounded-[2px] border border-xp-border bg-transparent px-3 py-1 text-xs text-xp-text transition-colors hover:bg-xp-surface-light"
          >
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  );
};

interface InputPromptContentProps {
  description?: string;
  placeholder?: string;
  initialValue?: string;
  selectNameWithoutExtension?: boolean;
  validate?: (value: string) => string | undefined;
  submitText?: string;
  cancelText?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const InputPromptContent = ({
  description,
  placeholder = '',
  initialValue = '',
  selectNameWithoutExtension = false,
  validate,
  submitText = 'Create',
  cancelText = 'Cancel',
  onSubmit,
  onCancel,
}: InputPromptContentProps) => {
  const [value, setValue] = React.useState(initialValue);
  const errorId = React.useId();
  const normalizedValue = value.trim();
  const validationMessage = normalizedValue ? validate?.(normalizedValue) : undefined;
  const canSubmit = Boolean(normalizedValue) && !validationMessage;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(normalizedValue);
      }}
    >
      {description && (
        <p className="text-sm leading-relaxed text-xp-text-secondary">{description}</p>
      )}
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => {
          if (!initialValue) return;
          if (selectNameWithoutExtension) {
            const lastDot = initialValue.lastIndexOf('.');
            event.currentTarget.setSelectionRange(0, lastDot > 0 ? lastDot : initialValue.length);
          } else {
            event.currentTarget.select();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-[2px] border border-xp-border bg-xp-surface-light px-3 py-2 text-sm text-xp-text transition-colors placeholder:text-xp-text-muted hover:border-xp-border-light focus:border-xp-text-secondary focus:outline-none"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        aria-invalid={Boolean(validationMessage)}
        aria-describedby={validationMessage ? errorId : undefined}
      />
      {validationMessage && (
        <p id={errorId} role="alert" className="-mt-2 text-xs leading-relaxed text-xp-red">
          {validationMessage}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[2px] border border-xp-border bg-transparent px-3.5 py-2 text-xs font-medium text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
        >
          {cancelText}
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-[2px] bg-xp-accent px-4 py-2 text-xs font-medium text-xp-on-accent transition-colors hover:bg-xp-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitText}
        </button>
      </div>
    </form>
  );
};

interface ConfirmationPromptContentProps {
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationPromptContent = ({
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmationPromptContentProps) => (
  <div className="space-y-4">
    {description && <p className="text-sm leading-relaxed text-xp-text-secondary">{description}</p>}
    <div className="flex justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-[2px] border border-xp-border bg-transparent px-3.5 py-2 text-xs font-medium text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
      >
        {cancelText}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        autoFocus
        className="rounded-[2px] bg-xp-red px-4 py-2 text-xs font-medium text-xp-on-accent transition-opacity hover:opacity-85"
      >
        {confirmText}
      </button>
    </div>
  </div>
);

// Helper functions to show confirmation and input toasts
export const showConfirmationToast = (
  options: Omit<ConfirmationToastProps, 'onConfirm' | 'onCancel'>,
): Promise<boolean> => {
  return new Promise((resolve) => {
    let settled = false;
    let dismissDialog = () => {};
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
      dismissDialog();
    };

    const { dismiss } = toast({
      title: options.title,
      description: (
        <ConfirmationPromptContent
          description={options.description}
          confirmText={options.confirmText}
          cancelText={options.cancelText}
          onConfirm={() => finish(true)}
          onCancel={() => finish(false)}
        />
      ),
      presentation: 'dialog',
      autoDismiss: false,
      onOpenChange: (open) => {
        if (!open) finish(false);
      },
    });
    dismissDialog = dismiss;
  });
};

export const showInputToast = (
  options: Omit<InputToastProps, 'onSubmit' | 'onCancel'>,
): Promise<string | null> => {
  return new Promise((resolve) => {
    let settled = false;
    let dismissDialog = () => {};
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
      dismissDialog();
    };

    const { dismiss } = toast({
      title: options.title,
      description: (
        <InputPromptContent
          description={options.description}
          placeholder={options.placeholder}
          initialValue={options.initialValue}
          selectNameWithoutExtension={options.selectNameWithoutExtension}
          validate={options.validate}
          submitText={options.submitText}
          cancelText={options.cancelText}
          onSubmit={(value) => finish(value)}
          onCancel={() => finish(null)}
        />
      ),
      presentation: 'dialog',
      autoDismiss: false,
      onOpenChange: (open) => {
        if (!open) finish(null);
      },
    });
    dismissDialog = dismiss;
  });
};

export { Toast, ConfirmationToast, InputToast };
