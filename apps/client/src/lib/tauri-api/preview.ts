/**
 * Finder-parity preview bridges (Rust `operations/preview_ops`).
 *
 * These wrap the same macOS frameworks Quick Look uses — ImageIO (sips),
 * NSAttributedString (textutil), plutil, qlmanage — and return paths to
 * converted artefacts inside the asset-protocol scope, plus a content
 * sniffer that mirrors Finder's "any text file previews" behaviour.
 */

import { transport } from '../transport';

/** HEIC/RAW/PSD/… → downscaled JPEG path, or null when undecodable. */
export const previewConvertImage = async (path: string, maxDim = 2048): Promise<string | null> =>
  await transport('preview_convert_image', { path, maxDim });

/** doc/docx/rtf/rtfd/odt/webarchive → generated HTML path, or null. */
export const previewDocHtml = async (path: string): Promise<string | null> =>
  await transport('preview_doc_html', { path });

/** XML/binary plist (and .strings) → XML text. */
export const previewPlistXml = async (path: string): Promise<string> =>
  await transport('preview_plist_xml', { path });

/** Quick Look thumbnail (pptx/usdz/icc/video poster/…) → PNG path, or null. */
export const previewQlThumbnail = async (path: string, size = 1024): Promise<string | null> =>
  await transport('preview_ql_thumbnail', { path, size });

/** iWork (pages/numbers/key) embedded QuickLook/Preview.pdf path, or null. */
export const previewIworkPdf = async (path: string): Promise<string | null> =>
  await transport('preview_iwork_pdf', { path });

export interface EpubChapter {
  href: string;
  title: string;
}

export interface EpubInfo {
  base_dir: string;
  chapters: EpubChapter[];
}

/** Unpack an epub and resolve its spine + chapter titles, or null. */
export const previewEpub = async (path: string): Promise<EpubInfo | null> =>
  await transport('preview_epub', { path });

/** ffmpeg stream-copy remux (avi/mkv/… → mp4) path, or null when impossible. */
export const previewRemuxMedia = async (path: string): Promise<string | null> =>
  await transport('preview_remux_media', { path });

/**
 * Raw binary media read (up to ~2.5GB) via Tauri's binary IPC channel — the
 * generic read_binary_file is capped at 500MB and JSON-serializes bytes.
 * Returns the raw bytes; invoke() hands back an ArrayBuffer directly.
 */
export const previewReadMedia = async (path: string): Promise<Uint8Array> => {
  const { invoke } = await import('@tauri-apps/api/core');
  const buf = await invoke<ArrayBuffer>('preview_read_media', { path });
  return new Uint8Array(buf);
};

/** True when the file's leading bytes look like UTF-8 text (no NULs). */
export const previewSniffText = async (path: string): Promise<boolean> => {
  try {
    return await transport('preview_sniff_text', { path });
  } catch {
    return false;
  }
};
