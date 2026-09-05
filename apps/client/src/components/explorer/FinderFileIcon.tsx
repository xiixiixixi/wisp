import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { convertAssetUrl, isTauri } from '@/lib/transport';

const NATIVE_THUMBNAIL_SIZE = 96;
const MAX_VISUAL_CACHE_SIZE = 320;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_QUEUED_REQUESTS = 32;

const WEB_IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

// Formats whose Quick Look result is a poster/frame worth showing in lists.
// Everything else renders as the macOS type icon (NSWorkspace), not a preview.
const VIDEO_EXTENSIONS = new Set(['avi', 'mkv', 'mov', 'mp4', 'webm']);

interface ScheduledRequest {
  promise: Promise<string | null>;
  accepted: boolean;
  cancel: () => boolean;
}

interface VisualCacheEntry {
  promise: Promise<string | null>;
  subscribers: number;
  settled: boolean;
  cancelQueued: () => boolean;
}

interface VisualRequest {
  promise: Promise<string | null>;
  release: () => void;
}

interface QueuedRequest {
  start: () => void;
  cancel: () => boolean;
}

const visualCache = new Map<string, VisualCacheEntry>();
const requestQueue: QueuedRequest[] = [];
let activeRequests = 0;

const extensionOf = (file: FileEntry): string =>
  file.name.includes('.') ? (file.name.split('.').pop()?.toLowerCase() ?? '') : '';

const isRemotePath = (path: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(path);

const pumpQueue = () => {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    requestQueue.shift()?.start();
  }
};

const scheduleNativeRequest = (task: () => Promise<string | null>): ScheduledRequest => {
  let state: 'queued' | 'running' | 'settled' | 'cancelled' = 'queued';
  let resolveRequest: (value: string | null) => void = () => undefined;
  const promise = new Promise<string | null>((resolve) => {
    resolveRequest = resolve;
  });

  const queuedRequest: QueuedRequest = {
    start: () => {
      if (state !== 'queued') return;
      state = 'running';
      activeRequests += 1;
      Promise.resolve()
        .then(task)
        .catch(() => null)
        .then(resolveRequest)
        .finally(() => {
          state = 'settled';
          activeRequests -= 1;
          pumpQueue();
        });
    },
    cancel: () => {
      if (state !== 'queued') return false;
      state = 'cancelled';
      const queueIndex = requestQueue.indexOf(queuedRequest);
      if (queueIndex >= 0) requestQueue.splice(queueIndex, 1);
      resolveRequest(null);
      pumpQueue();
      return true;
    },
  };

  const canStartImmediately = activeRequests < MAX_CONCURRENT_REQUESTS;
  const accepted = canStartImmediately || requestQueue.length < MAX_QUEUED_REQUESTS;
  if (canStartImmediately) {
    queuedRequest.start();
  } else if (accepted) {
    requestQueue.push(queuedRequest);
  } else {
    queuedRequest.cancel();
  }

  return { promise, accepted, cancel: queuedRequest.cancel };
};

const trimVisualCache = () => {
  while (visualCache.size > MAX_VISUAL_CACHE_SIZE) {
    const settledEntry = [...visualCache.entries()].find(([, entry]) => entry.settled);
    if (!settledEntry) return;
    visualCache.delete(settledEntry[0]);
  }
};

const subscribeToCacheEntry = (key: string, entry: VisualCacheEntry): VisualRequest => {
  entry.subscribers += 1;
  let released = false;
  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.subscribers -= 1;
      if (entry.subscribers === 0 && !entry.settled && entry.cancelQueued()) {
        if (visualCache.get(key) === entry) visualCache.delete(key);
      }
    },
  };
};

const cacheVisual = (key: string, loader: () => ScheduledRequest): VisualRequest => {
  const cached = visualCache.get(key);
  if (cached) {
    // Refresh insertion order so simple eviction behaves like a small LRU.
    visualCache.delete(key);
    visualCache.set(key, cached);
    return subscribeToCacheEntry(key, cached);
  }

  const scheduled = loader();
  if (!scheduled.accepted) {
    return { promise: scheduled.promise, release: () => undefined };
  }

  const entry: VisualCacheEntry = {
    promise: scheduled.promise,
    subscribers: 0,
    settled: false,
    cancelQueued: scheduled.cancel,
  };
  visualCache.set(key, entry);
  entry.promise.then((url) => {
    entry.settled = true;
    // Cancellation and transient Quick Look failures should be retryable the
    // next time the item approaches the viewport.
    if (!url && visualCache.get(key) === entry) visualCache.delete(key);
  });
  trimVisualCache();
  return subscribeToCacheEntry(key, entry);
};

const resolvedVisual = (key: string, url: string): VisualRequest => {
  const cached = visualCache.get(key);
  if (cached) {
    visualCache.delete(key);
    visualCache.set(key, cached);
    return subscribeToCacheEntry(key, cached);
  }

  const entry: VisualCacheEntry = {
    promise: Promise.resolve(url),
    subscribers: 0,
    settled: true,
    cancelQueued: () => false,
  };
  visualCache.set(key, entry);
  trimVisualCache();
  return subscribeToCacheEntry(key, entry);
};

const emptyVisualRequest = (): VisualRequest => ({
  promise: Promise.resolve(null),
  release: () => undefined,
});

const loadFinderVisual = (file: FileEntry): VisualRequest => {
  if (!isTauri() || isRemotePath(file.path)) return emptyVisualRequest();

  const extension = extensionOf(file);
  const cacheKey = `${file.path}\u0000${file.modified}\u0000${file.size}\u0000${NATIVE_THUMBNAIL_SIZE}`;
  // Browser-native formats are already the highest-fidelity thumbnail: the
  // file itself.
  if (!file.is_dir && WEB_IMAGE_EXTENSIONS.has(extension)) {
    return resolvedVisual(cacheKey, convertAssetUrl(file.path));
  }
  // Video: the poster frame IS the right list visual (Finder does the same).
  if (!file.is_dir && VIDEO_EXTENSIONS.has(extension)) {
    return cacheVisual(cacheKey, () =>
      scheduleNativeRequest(async () => {
        const thumbnailPath = await TauriAPI.getFileThumbnailPng(file.path, NATIVE_THUMBNAIL_SIZE);
        return convertAssetUrl(thumbnailPath);
      }),
    );
  }
  // Everything else — Office docs, PDFs, EPUB, archives, code, plain text —
  // gets the real macOS type icon via NSWorkspace (blue Word W, green Excel X,
  // orange Keynote P…), exactly what Finder's list views draw. Quick Look
  // content previews are wrong here: a wall of near-identical page thumbnails
  // destroys at-a-glance type recognition. NSWorkspace icons resolve instantly
  // (no per-file Quick Look subprocess) and the command caches on disk.
  return cacheVisual(`icon\u0000${file.path}`, () =>
    scheduleNativeRequest(async () => convertAssetUrl(await TauriAPI.getFileIconPng(file.path))),
  );
};

type DemoVisualKind =
  | 'folder'
  | 'image'
  | 'pdf'
  | 'book'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'document';

const demoVisualKind = (file: FileEntry): DemoVisualKind => {
  if (file.is_dir) return 'folder';
  const ext = extensionOf(file);
  if (WEB_IMAGE_EXTENSIONS.has(ext) || ['heic', 'heif', 'tif', 'tiff'].includes(ext)) {
    return 'image';
  }
  if (ext === 'pdf') return 'pdf';
  if (['epub', 'mobi', 'azw', 'azw3', 'cbz', 'cbr'].includes(ext)) return 'book';
  if (['doc', 'docx', 'docm', 'odt', 'rtf', 'pages'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext)) return 'spreadsheet';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'presentation';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'dmg'].includes(ext)) return 'archive';
  if (
    [
      'c',
      'cpp',
      'css',
      'go',
      'html',
      'java',
      'js',
      'json',
      'py',
      'rb',
      'rs',
      'sh',
      'swift',
      'ts',
      'tsx',
    ].includes(ext)
  ) {
    return 'code';
  }
  return 'document';
};

const DemoDocumentFrame = ({ children }: { children: React.ReactNode }) => (
  <>
    <path d="M9 3.5h21l9 9V44H9z" fill="#fff" stroke="#aeb6c2" strokeWidth="1.2" />
    <path d="M30 3.5v9h9" fill="#e8edf3" stroke="#aeb6c2" strokeWidth="1.2" />
    {children}
  </>
);

/** Deterministic stand-ins for the browser demo, whose /home/user files do
 * not exist on disk. The desktop build never uses these drawings. */
const DemoFinderVisual = ({ file }: { file: FileEntry }) => {
  const kind = demoVisualKind(file);

  if (kind === 'folder') {
    return (
      <svg
        viewBox="0 0 48 48"
        width="1em"
        height="1em"
        aria-hidden="true"
        data-demo-file-visual={kind}
      >
        <path d="M4 12.5c0-2 1.6-3.5 3.5-3.5H19l4 4h17.5c2 0 3.5 1.6 3.5 3.5v3H4z" fill="#77c5ff" />
        <path d="M4 17h40v21.5c0 2-1.6 3.5-3.5 3.5h-33C5.6 42 4 40.4 4 38.5z" fill="#4aa7f2" />
        <path d="M6 18.5h36" stroke="#a9ddff" strokeWidth="1.4" opacity=".9" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 48 48"
      width="1em"
      height="1em"
      aria-hidden="true"
      data-demo-file-visual={kind}
    >
      <DemoDocumentFrame>
        {kind === 'pdf' && (
          <>
            <rect x="13" y="9" width="18" height="28" rx="1.5" fill="#df5148" />
            <rect x="16" y="13" width="12" height="3" rx="1" fill="#fff" opacity=".95" />
            <rect x="16" y="19" width="9" height="1.5" rx=".75" fill="#fff" opacity=".82" />
            <rect x="16" y="23" width="12" height="1.5" rx=".75" fill="#fff" opacity=".72" />
            <rect x="16" y="27" width="10" height="6" rx="1" fill="#8e2724" opacity=".58" />
          </>
        )}
        {kind === 'book' && (
          <>
            <rect x="13" y="8" width="20" height="30" rx="1.5" fill="#477bb9" />
            <rect x="13" y="8" width="3" height="30" rx="1" fill="#2b568a" />
            <circle cx="23" cy="19" r="5" fill="#f2d17b" />
            <path d="M18 29h11M18 32h8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}
        {kind === 'word' && (
          <>
            <rect x="13" y="10" width="20" height="27" rx="1" fill="#eaf2fb" stroke="#5b8fc9" />
            <rect x="13" y="10" width="20" height="5" fill="#3f77bd" />
            <text
              x="23"
              y="30"
              textAnchor="middle"
              fontFamily="-apple-system, 'SF Pro Text', sans-serif"
              fontWeight="700"
              fontSize="15"
              fill="#3f77bd"
            >
              W
            </text>
          </>
        )}
        {kind === 'spreadsheet' && (
          <>
            <rect x="13" y="10" width="20" height="27" rx="1" fill="#edf7ee" stroke="#5c9e66" />
            <rect x="13" y="10" width="20" height="5" fill="#4f9c62" />
            <path
              d="M13 20h20M13 25h20M13 30h20M20 15v22M27 15v22"
              stroke="#75ad7d"
              strokeWidth="1"
            />
          </>
        )}
        {kind === 'presentation' && (
          <>
            <rect x="13" y="11" width="21" height="24" rx="1.5" fill="#e8783f" />
            <rect x="16" y="15" width="15" height="3" rx="1" fill="#fff" />
            <circle cx="21" cy="25" r="4" fill="#ffd9bf" />
            <path d="M27 23h4M27 27h4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}
        {kind === 'image' && (
          <>
            <rect x="12.5" y="10" width="22" height="27" rx="1.5" fill="#bfe3fb" />
            <circle cx="28" cy="17" r="3" fill="#fff4b0" />
            <path d="m13 34 7-10 5 6 4-5 5 9z" fill="#55a875" />
          </>
        )}
        {kind === 'video' && (
          <>
            <rect x="12.5" y="11" width="22" height="25" rx="2" fill="#374151" />
            <path d="m21 18 9 5.5-9 5.5z" fill="#fff" />
          </>
        )}
        {kind === 'audio' && (
          <>
            <circle cx="23" cy="25" r="10" fill="#9b6ac8" />
            <path d="M25 17v13.5a3 3 0 1 1-1.7-2.7V19l6-1.5V25a3 3 0 1 1-1.7-2.7v-7z" fill="#fff" />
          </>
        )}
        {kind === 'archive' && (
          <>
            <rect x="13" y="12" width="20" height="24" rx="2" fill="#c99a5e" />
            <path d="M23 12h5v4h-5v4h5v4h-5v4h5v4h-5v4" stroke="#79562f" strokeWidth="2" />
          </>
        )}
        {kind === 'code' && (
          <>
            <rect x="13" y="10" width="20" height="27" rx="1.5" fill="#e8eef5" />
            <path
              d="m21 19-4 4 4 4M26 19l4 4-4 4M25 16l-3 14"
              stroke="#4f6f91"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
        {kind === 'document' && (
          <>
            <rect x="13" y="10" width="20" height="6" rx="1" fill="#dfe7f0" />
            <path
              d="M14 21h17M14 25h14M14 29h17M14 33h11"
              stroke="#8e99a6"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        )}
      </DemoDocumentFrame>
    </svg>
  );
};

interface FinderFileIconProps {
  file: FileEntry;
  fallback: React.ReactNode;
}

/**
 * A Finder-faithful file visual: real file content for web-native images,
 * Quick Look icon-mode thumbnails for everything macOS knows how to preview,
 * and the existing semantic icon while a native result loads or fails.
 */
const FinderFileIcon = ({ file, fallback }: FinderFileIconProps) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [nearViewport, setNearViewport] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const demoMode = isBrowserDemoMode();
  const nativeMode = isTauri() && !isRemotePath(file.path);
  const visualKey = useMemo(
    () => `${file.path}\u0000${file.modified}\u0000${file.size}`,
    [file.modified, file.path, file.size],
  );

  useEffect(() => {
    if (demoMode || !nativeMode) return;
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const ownEntry = entries.find((entry) => entry.target === element);
        if (ownEntry) setNearViewport(ownEntry.isIntersecting);
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [demoMode, nativeMode]);

  useEffect(() => {
    if (demoMode || !nativeMode || !nearViewport || failedKey === visualKey) return;
    let cancelled = false;
    const request = loadFinderVisual(file);
    request.promise.then((url) => {
      if (!cancelled && url) setResolved({ key: visualKey, url });
    });
    return () => {
      cancelled = true;
      request.release();
    };
  }, [demoMode, failedKey, file, nativeMode, nearViewport, visualKey]);

  const visualUrl = resolved?.key === visualKey ? resolved.url : null;
  let visual: React.ReactNode = fallback;
  if (demoMode) {
    visual = <DemoFinderVisual file={file} />;
  } else if (visualUrl) {
    visual = (
      <img
        src={visualUrl}
        alt=""
        draggable={false}
        className="h-full w-full object-contain"
        onError={() => {
          setFailedKey(visualKey);
          setResolved(null);
        }}
      />
    );
  } else if (nativeMode && !failedKey) {
    // Native icon still resolving: show NOTHING rather than the generic
    // fallback — flashing a placeholder and then swapping to the real
    // icon read as "two icon sets". Keep the space reserved so rows
    // don't shift; the disk cache makes this a one-frame blank at most.
    visual = <span className="opacity-0">{fallback}</span>;
  }

  return (
    <span
      ref={containerRef}
      className="inline-flex shrink-0 items-center justify-center align-[-0.125em]"
      style={{ width: '1em', height: '1em', lineHeight: 1 }}
      aria-hidden="true"
      data-finder-file-icon={file.path}
    >
      {visual}
    </span>
  );
};

export default React.memo(FinderFileIcon);
