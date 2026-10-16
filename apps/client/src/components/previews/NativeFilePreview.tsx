import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TauriAPI, type QuickLookFrame } from '@/lib/tauri-api';
import type { PreviewProps } from '@/lib/preview-factory';
import { PreviewSkeleton } from '@/components/ui/Skeleton';

// Serialize across component instances: a slow mount must finish before its
// cleanup and before the next file attaches. Native session IDs guard cleanup.
let nativeQueue: Promise<void> = Promise.resolve();
const enqueue = (operation: () => Promise<void>) => {
  const result = nativeQueue.then(operation);
  nativeQueue = result.catch(() => {});
  return result;
};

const overlaySelector =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-native-preview-occluder], #wisp-bottom-right-overlay-stack';

function measure(host: HTMLElement): { frame: QuickLookFrame; visible: boolean } {
  const rect = host.getBoundingClientRect();
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(viewportWidth, rect.right);
  let bottom = Math.min(viewportHeight, rect.bottom);
  let visible = document.visibilityState !== 'hidden';

  for (let element: HTMLElement | null = host; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (
      element.hidden ||
      element.getAttribute('aria-hidden') === 'true' ||
      style.display === 'none' ||
      style.visibility === 'hidden'
    ) {
      visible = false;
    }
    if (element !== host) {
      const bounds = element.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left);
        right = Math.min(right, bounds.right);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
      }
    }
  }
  // Native views sit above the web content. Only an overlapping overlay
  // should hide them: the adjacent file grid also has the listbox role.
  // Hiding preserves the current slide and keeps overlay controls usable.
  for (const overlay of document.querySelectorAll<HTMLElement>(overlaySelector)) {
    const bounds = overlay.getBoundingClientRect();
    const style = getComputedStyle(overlay);
    if (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.left < right &&
      bounds.right > left &&
      bounds.top < bottom &&
      bounds.bottom > top &&
      !overlay.contains(host) &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      overlay.getAttribute('aria-hidden') !== 'true'
    ) {
      visible = false;
      break;
    }
  }
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    frame: { x: left, y: top, width, height, viewportWidth, viewportHeight },
    visible: visible && width > 0 && height > 0,
  };
}

/** The system owns document layout, page navigation, zoom and its loading state. */
export default function NativeFilePreview({
  file,
  children,
}: PreviewProps & { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [attached, setAttached] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const sessionId = crypto.randomUUID();
    let disposed = false;
    let mounted = false;
    let pending = false;
    let animationFrame = 0;
    let lastLayout = '';
    setAttached(false);
    setUnavailable(false);

    const close = () => enqueue(() => TauriAPI.previewCloseQlView(sessionId)).catch(() => {});
    const sync = () => {
      if (disposed || pending) return;
      pending = true;
      void enqueue(async () => {
        pending = false;
        if (disposed) return;
        const layout = measure(host);
        const signature = JSON.stringify(layout);
        if (!mounted) {
          await TauriAPI.previewMountQlView(file.path, sessionId, layout.frame, layout.visible);
          mounted = true;
          // This confirms attachment only. Quick Look loads the actual file
          // asynchronously and displays its own loading/error UI.
          if (!disposed) setAttached(true);
        } else if (signature !== lastLayout) {
          await TauriAPI.previewUpdateQlView(sessionId, layout.frame, layout.visible);
        }
        lastLayout = signature;
      }).catch(() => {
        if (!disposed) {
          disposed = true;
          void close();
          setUnavailable(true);
        }
      });
    };
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(sync);
    };
    const unload = () => {
      disposed = true;
      void close();
    };
    const resize = new ResizeObserver(schedule);
    for (let element: HTMLElement | null = host; element; element = element.parentElement) {
      resize.observe(element);
    }
    const changes = new MutationObserver(schedule);
    changes.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open', 'data-state', 'role'],
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('pagehide', unload);
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('transitionend', schedule, true);
    sync();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resize.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pagehide', unload);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('visibilitychange', schedule);
      document.removeEventListener('transitionend', schedule, true);
      void close();
    };
  }, [file.path, file.modified]);

  if (unavailable) return children;

  return (
    <div
      ref={hostRef}
      className="relative h-full min-h-0 w-full overflow-hidden bg-xp-surface"
      data-native-document={file.path}
    >
      {!attached && <PreviewSkeleton />}
    </div>
  );
}
