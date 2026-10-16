/**
 * pi-engine fetch channel.
 *
 * pi-ai performs its provider HTTP with the fetch implementation passed via
 * `options.fetch`. In the Tauri WebView we route those requests through
 * tauri-plugin-http (executed on the Rust side) so WKWebView CORS never
 * applies; in the browser demo (?demo=1) we fall back to global fetch.
 */
import { isTauri } from '@/lib/transport';

export type PiFetch = typeof globalThis.fetch;

let pluginFetch: PiFetch | null = null;

const loadPluginFetch = async (): Promise<PiFetch | null> => {
  if (!isTauri()) return null;
  if (pluginFetch) return pluginFetch;
  try {
    const mod = await import('@tauri-apps/plugin-http');
    pluginFetch = mod.fetch as PiFetch;
    return pluginFetch;
  } catch {
    // Plugin unavailable (older bundle / browser demo) — direct fetch.
    return null;
  }
};

/** Fetch implementation for pi-ai provider requests. */
export const piFetch: PiFetch = async (input, init) => {
  const impl = (await loadPluginFetch()) ?? globalThis.fetch;
  return impl(input, init);
};
