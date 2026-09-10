/**
 * Media source loading for audio/video previews.
 *
 * Streaming-first: the custom `media://` scheme (Rust media_protocol.rs)
 * answers HTTP Range requests with 206 + Content-Range, so WebKit's media
 * engine streams straight from disk — instant start, instant seeks, no full
 * read. The whole-file Blob path is gone; remuxable containers (avi/mkv/…)
 * are stream-copy remuxed to mp4 first, then streamed the same way.
 */

import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', mp2: 'audio/mpeg',
  m4a: 'audio/mp4', m4b: 'audio/mp4', m4r: 'audio/mp4', alac: 'audio/mp4',
  aac: 'audio/aac', ac3: 'audio/ac3',
  wav: 'audio/wav', aiff: 'audio/aiff', aif: 'audio/aiff', aifc: 'audio/aiff',
  caf: 'audio/x-caf', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wma: 'audio/x-ms-wma',
  mp4: 'video/mp4', m4v: 'video/mp4',
  mov: 'video/quicktime', qt: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', m1v: 'video/mpeg', m2v: 'video/mpeg',
  '3gp': 'video/3gpp', '3g2': 'video/3gpp2', ogv: 'video/ogg',
};

export type MediaKind = 'audio' | 'video';

export const mimeForFile = (name: string, kind: MediaKind): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? (kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
};

/** Containers AVFoundation/WebKit cannot open — remux to mp4 first. */
const REMUX_VIDEO_EXTENSIONS = new Set([
  'avi', 'mkv', 'wmv', 'flv', 'mpg', 'mpeg', 'm1v', 'm2v', 'ogv',
]);

export interface MediaSource {
  url: string;
  objectUrl: boolean;
  dispose: () => void;
}

/** media:// URL for a file path (urlencoded absolute path). */
export const mediaUrl = (path: string): string =>
  `media://localhost/${encodeURIComponent(path)}`;

export async function loadMediaSource(
  path: string,
  name: string,
  kind: MediaKind,
  size: number,
): Promise<MediaSource> {
  const direct = (): MediaSource => ({
    url: mediaUrl(path),
    objectUrl: false,
    dispose: () => undefined,
  });

  if (!isTauri()) return direct();

  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  // Container WebKit can never open → stream-copy remux to mp4, then stream
  // the remuxed file. Failure (no ffmpeg, incompatible codecs) falls back to
  // the direct URL whose error path triggers the poster fallback.
  if (kind === 'video' && REMUX_VIDEO_EXTENSIONS.has(ext)) {
    try {
      const remuxed = await TauriAPI.previewRemuxMedia(path);
      if (remuxed) {
        return { url: mediaUrl(remuxed), objectUrl: false, dispose: () => undefined };
      }
    } catch (err) {
      console.warn('remux failed, falling back to direct URL:', err);
    }
    return direct();
  }

  // Native-playable formats stream directly; size is irrelevant for range
  // requests (a 4GB mp4 starts playing instantly).
  void size;
  return direct();
}
