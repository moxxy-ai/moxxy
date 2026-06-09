/**
 * The transport singleton every store/hook reaches through to talk to the host.
 *
 * Platform-agnostic by construction: the renderer used to read `window.moxxy`
 * here, but that coupling now lives in each platform's boot shim, which calls
 * {@link configureTransport} once at startup —
 *   - desktop: `configureTransport(window.moxxy)` (the Electron preload bridge)
 *   - mobile:  `configureTransport(makeWsApi(url, token))` (the WebSocket client)
 *
 * The {@link api} alias preserves the original call shape (`api()`), so every
 * store/hook call-site is unchanged.
 */

import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';

let configured: MoxxyApi | null = null;
let override: MoxxyApi | null = null;

/** Install the transport at boot. Idempotent — last call wins. */
export function configureTransport(transport: MoxxyApi): void {
  configured = transport;
}

/** The active transport. Throws if neither configured nor test-overridden. */
export function getTransport(): MoxxyApi {
  if (override) return override;
  if (configured) return configured;
  throw new Error(
    'moxxy transport is not configured — call configureTransport() at boot, ' +
      'or __setApiOverride() in tests.',
  );
}

/**
 * Back-compat accessor. Every store/hook does `api().invoke(...)` /
 * `api().subscribe(...)`; aliasing `api` to {@link getTransport} keeps those
 * call-sites identical to the pre-extraction code.
 */
export const api = getTransport;

/** Inject a fake transport for tests (clears with `null`). */
export function __setApiOverride(fake: MoxxyApi | null): void {
  override = fake;
}
