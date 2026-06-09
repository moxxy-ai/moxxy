/**
 * Wire the shared client layer to this platform (the Electron renderer) once,
 * at startup, BEFORE React renders. The transport is the preload's
 * `window.moxxy`; the platform capabilities are the Web implementations.
 *
 * This is the one place the renderer reaches for `window.moxxy` — the shared
 * `@moxxy/client-core` stays transport-agnostic, and a future mobile app boots
 * the same hooks with a WebSocket transport + Expo capabilities instead.
 */

import { configureTransport } from '@moxxy/client-core/transport';
import { configurePlatform } from '@moxxy/client-core/platform';
import { webPlatform } from '@moxxy/client-platform-web';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';

export function bootClient(): void {
  const moxxy = (window as unknown as { moxxy?: MoxxyApi }).moxxy;
  // Best-effort: a preload-less context (some tests) degrades to an unconfigured
  // transport, exactly as the old `api()` threw lazily on first use.
  if (moxxy) configureTransport(moxxy);
  configurePlatform(webPlatform);
}
