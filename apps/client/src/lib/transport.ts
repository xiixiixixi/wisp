/**
 * Transport abstraction layer for Wisp.
 *
 * The canonical implementation lives in `@wisp/sdk`.  This module
 * re-exports everything so existing imports (`@/lib/transport`) keep working.
 */
export { transport, listenToEvent, convertAssetUrl, isTauri, getApiUrl } from '@wisp/sdk';
