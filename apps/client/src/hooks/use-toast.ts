import * as React from 'react';
import { addNotification } from './use-notification-history';

// Simplified toast types without shadcn/ui dependency
type ToastActionElement = React.ReactElement;
type ToastProps = {
  variant?: 'default' | 'destructive';
  className?: string;
  open?: boolean;
  presentation?: 'toast' | 'dialog';
  autoDismiss?: boolean;
  returnFocus?: HTMLElement | null;
};

const NOTIFICATION_TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 1000;
export const TOAST_AUTO_DISMISS_DELAY = 10000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
  onOpenChange?: (open: boolean) => void;
};

let count = 0;

const genId = () => {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
};

type ActionType = {
  readonly ADD_TOAST: 'ADD_TOAST';
  readonly UPDATE_TOAST: 'UPDATE_TOAST';
  readonly DISMISS_TOAST: 'DISMISS_TOAST';
  readonly REMOVE_TOAST: 'REMOVE_TOAST';
};

type Action =
  | {
      type: ActionType['ADD_TOAST'];
      toast: ToasterToast;
    }
  | {
      type: ActionType['UPDATE_TOAST'];
      toast: Partial<ToasterToast>;
    }
  | {
      type: ActionType['DISMISS_TOAST'];
      toastId?: ToasterToast['id'];
    }
  | {
      type: ActionType['REMOVE_TOAST'];
      toastId?: ToasterToast['id'];
    };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: 'REMOVE_TOAST',
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'ADD_TOAST': {
      const existingNotifications = state.toasts.filter((item) => item.presentation !== 'dialog');
      if (action.toast.presentation === 'dialog') {
        return {
          ...state,
          // Dialogs have their own slot. `toast()` closes the previous dialog
          // before dispatching this action, while the reducer also enforces a
          // single-dialog state for direct reducer callers.
          toasts: [action.toast, ...existingNotifications],
        };
      }

      const activeDialog = state.toasts.find((item) => item.presentation === 'dialog');
      const notifications = [action.toast, ...existingNotifications].slice(
        0,
        NOTIFICATION_TOAST_LIMIT,
      );
      return {
        ...state,
        toasts: activeDialog ? [...notifications, activeDialog] : notifications,
      };
    }

    case 'UPDATE_TOAST':
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      };

    case 'DISMISS_TOAST': {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case 'REMOVE_TOAST':
      if (action.toastId === undefined) {
        toastTimeouts.forEach((timeout) => clearTimeout(timeout));
        toastTimeouts.clear();
        return {
          ...state,
          toasts: [],
        };
      }
      if (action.toastId) {
        const timeout = toastTimeouts.get(action.toastId);
        if (timeout) {
          clearTimeout(timeout);
          toastTimeouts.delete(action.toastId);
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

const dispatch = (action: Action) => {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
};

export type Toast = Omit<ToasterToast, 'id'>;

const dismissToastState = (toastId?: string) => {
  dispatch({ type: 'DISMISS_TOAST', toastId });
};

const dismissAndSettleDialogs = (toastId?: string) => {
  const dialogs = memoryState.toasts.filter(
    (item) =>
      item.presentation === 'dialog' &&
      item.open !== false &&
      (toastId === undefined || item.id === toastId),
  );

  // Dialog helpers resolve their Promise from onOpenChange(false). Keep that
  // contract for programmatic dismisses as well as clicks and Escape.
  dialogs.forEach((item) => item.onOpenChange?.(false));
  dismissToastState(toastId);
};

const closeExistingDialogs = () => {
  // Interactive toast helpers settle their Promise from onOpenChange(false).
  // Removing a replaced dialog without this notification would leave that
  // Promise pending forever.
  while (true) {
    const existing = memoryState.toasts.find((item) => item.presentation === 'dialog');
    if (!existing) return;
    if (existing.open !== false) existing.onOpenChange?.(false);
    dispatch({ type: 'REMOVE_TOAST', toastId: existing.id });
  }
};

const toast = ({ ...props }: Toast) => {
  const id = genId();
  const externalOnOpenChange = props.onOpenChange;

  if (props.presentation === 'dialog') closeExistingDialogs();

  const update = (props: ToasterToast) =>
    dispatch({
      type: 'UPDATE_TOAST',
      toast: { ...props, id },
    });
  const dismiss = () => dismissAndSettleDialogs(id);

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      ...props,
      returnFocus:
        props.presentation === 'dialog'
          ? (props.returnFocus ?? (document.activeElement as HTMLElement | null))
          : props.returnFocus,
      id,
      open: true,
      onOpenChange: (open: boolean) => {
        externalOnOpenChange?.(open);
        // Use the raw state transition here: calling the public dismiss path
        // would notify this same callback recursively.
        if (!open) dismissToastState(id);
      },
    },
  });

  // Capture toast into notification history
  if (props.presentation !== 'dialog') {
    let titleStr: string;
    if (typeof props.title === 'string') {
      titleStr = props.title;
    } else if (props.title) {
      titleStr = String(props.title);
    } else {
      titleStr = '';
    }
    if (titleStr) {
      const descStr = typeof props.description === 'string' ? props.description : undefined;
      const type = props.variant === 'destructive' ? ('error' as const) : ('success' as const);
      addNotification(type, titleStr, descStr);
    }
  }

  // Interactive dialogs remain open until the user explicitly resolves them.
  if (props.autoDismiss !== false && props.presentation !== 'dialog') {
    setTimeout(dismiss, TOAST_AUTO_DISMISS_DELAY);
  }

  return {
    id,
    dismiss,
    update,
  };
};

const useToast = () => {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  const dismissToast = React.useCallback((toastId?: string) => {
    dismissAndSettleDialogs(toastId);
  }, []);

  const removeToast = React.useCallback((toastId?: string) => {
    dispatch({ type: 'REMOVE_TOAST', toastId });
  }, []);

  return {
    ...state,
    toast,
    dismiss: dismissToast,
    remove: removeToast,
  };
};

export { useToast, toast };
