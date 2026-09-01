import { invoke } from '@tauri-apps/api/core';
import { Globe } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

/**
 * A web page rendered inside a pane. The actual page is a NATIVE child
 * webview attached to the window over this div — iframes can't load most
 * sites (X-Frame-Options/CSP), so the div only reserves the layout rect and
 * streams its bounds down to Rust, which keeps the OS webview glued to it.
 */
const WebTabView = ({ tabId, url }: { tabId: string; url: string }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    let frame = 0;
    const syncBounds = (create: boolean) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      invoke(create ? 'web_tab_create' : 'web_tab_bounds', {
        id: tabId,
        url: urlRef.current,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }).catch(() => {});
    };

    syncBounds(true);

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncBounds(false));
    });
    observer.observe(element);
    window.addEventListener('resize', () => syncBounds(false));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      invoke('web_tab_destroy', { id: tabId }).catch(() => {});
    };
  }, [tabId, url]);

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // keep raw string
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-xp-bg">
      <div className="border-xp-border/40 flex h-9 shrink-0 items-center gap-2 border-b bg-xp-surface/60 px-3">
        <Globe size={13} className="text-xp-text-muted" aria-hidden="true" />
        <span className="bg-xp-bg/60 truncate rounded px-2.5 py-0.5 text-[11px] text-xp-text-secondary">
          {hostname}
        </span>
      </div>
      <div ref={contentRef} className="relative flex-1 bg-white" />
    </div>
  );
};

export default WebTabView;
