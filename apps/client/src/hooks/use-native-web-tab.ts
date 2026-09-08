import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, type RefObject } from 'react';
import { NativeWebTabSession } from '@/lib/native-web-tab';

export type WebLoadState = 'loading' | 'idle' | 'error';

export function useNativeWebTab({
  enabled,
  tabId,
  url,
  active,
  refresh,
  contentRef,
  onState,
}: {
  enabled: boolean;
  tabId: string;
  url: string;
  active: boolean;
  refresh: string;
  contentRef: RefObject<HTMLDivElement | null>;
  onState: (state: WebLoadState) => void;
}) {
  const latest = useRef({ url, active, refresh, onState });
  latest.current = { url, active, refresh, onState };
  const syncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let frame = 0;
    let connecting = false;
    let unlisten: (() => void) | undefined;
    const session = new NativeWebTabSession(
      tabId,
      invoke,
      () => {
        if (!disposed) latest.current.onState('loading');
      },
      () => {
        if (!disposed) latest.current.onState('error');
      },
    );
    const sync = () => {
      const current = latest.current;
      const rect = contentRef.current?.getBoundingClientRect();
      session.sync({
        ...current,
        bounds: {
          x: rect?.left ?? 0,
          y: rect?.top ?? 0,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        },
      });
    };
    // Subscribe before creating: cached pages can finish during the create call.
    // A failed event registration must also be retryable without remounting the tab.
    const connect = () => {
      if (connecting || disposed) return;
      connecting = true;
      void listen<{ id: string; loading: boolean }>('web-tab-load', ({ payload }) => {
        if (!disposed && payload.id === tabId) {
          latest.current.onState(payload.loading ? 'loading' : 'idle');
        }
      })
        .then((stop) => {
          if (disposed) {
            stop();
            return;
          }
          unlisten = stop;
          sync();
        })
        .catch(() => {
          if (!disposed) latest.current.onState('error');
        })
        .finally(() => {
          connecting = false;
        });
    };
    syncRef.current = () => {
      if (unlisten) sync();
      else connect();
    };
    connect();

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncRef.current?.());
    };
    const observer = new ResizeObserver(schedule);
    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener('resize', schedule);
    return () => {
      disposed = true;
      syncRef.current = null;
      unlisten?.();
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      session.dispose();
    };
  }, [enabled, tabId, contentRef]);

  useEffect(() => {
    syncRef.current?.();
  }, [url, active, refresh]);
}
