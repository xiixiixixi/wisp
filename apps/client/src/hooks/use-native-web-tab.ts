import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, type RefObject } from 'react';
import { NativeWebTabSession, type NativeWebPageState } from '@/lib/native-web-tab';

export type WebLoadState = 'loading' | 'idle' | 'error';

export function useNativeWebTab({
  enabled,
  tabId,
  url,
  active,
  refresh,
  contentRef,
  onState,
  onPageState,
}: {
  enabled: boolean;
  tabId: string;
  url: string;
  active: boolean;
  refresh: string;
  contentRef: RefObject<HTMLDivElement | null>;
  onState: (state: WebLoadState) => void;
  onPageState?: (state: NativeWebPageState) => void;
}) {
  const latest = useRef({ url, active, refresh, onState, onPageState });
  latest.current = { url, active, refresh, onState, onPageState };
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
      (error) => {
        console.warn('[web-tab] Native page operation failed', { tabId, error });
        if (!disposed) latest.current.onState('error');
      },
    );
    const sync = () => {
      const current = latest.current;
      const rect = contentRef.current?.getBoundingClientRect();
      void session.sync({
        ...current,
        bounds: {
          x: Math.round(rect?.left ?? 0),
          y: Math.round(rect?.top ?? 0),
          width: Math.round(rect?.width ?? 0),
          height: Math.round(rect?.height ?? 0),
        },
      });
    };
    let polling = false;
    const readPageState = async () => {
      if (disposed || polling || !session.ready || !latest.current.active) return;
      polling = true;
      try {
        const page = await invoke<NativeWebPageState>('web_tab_state', { id: tabId });
        // Observations must never be fed back as navigation requests: doing so
        // reloads redirects and creates a flashing/redirect loop.
        if (!disposed && latest.current.active && page && /^https?:\/\//i.test(page.url)) {
          latest.current.onPageState?.(page);
        }
      } catch (error) {
        if (!disposed) console.warn('[web-tab] Could not read page state', { tabId, error });
      } finally {
        polling = false;
      }
    };
    // Subscribe before creating: cached pages can finish during the create call.
    // A failed event registration must also be retryable without remounting the tab.
    const connect = () => {
      if (connecting || disposed) return;
      connecting = true;
      void listen<{ id: string; loading: boolean; error?: boolean }>(
        'web-tab-load',
        ({ payload }) => {
          if (!disposed && payload.id === tabId) {
            latest.current.onState(payload.error ? 'error' : payload.loading ? 'loading' : 'idle');
            void readPageState();
          }
        },
      )
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
    const stateTimer = window.setInterval(() => void readPageState(), 750);

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncRef.current?.());
    };
    const observer = new ResizeObserver(schedule);
    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener('resize', schedule);
    return () => {
      disposed = true;
      window.clearInterval(stateTimer);
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
