/**
 * The host<->app bridge protocol.
 *
 * A mini-app runs in a cross-origin iframe (origin `moxxy-app://assets/<id>`),
 * isolated from the host renderer by the same-origin policy. The only channel
 * between them is `window.postMessage`. This module defines the wire envelopes
 * and the typed method map carried over it; {@link ./client} is the app-side
 * convenience wrapper, and the host renderer relays each request to the main
 * process (which enforces the app's declared {@link ./permissions}).
 *
 * Each method maps to ONE permission. The host refuses (errors) any request for
 * a method whose permission the app didn't declare in its manifest — so the
 * manifest is the complete grant list and the bridge can't be used to reach a
 * capability the user didn't consent to at install.
 */

import type { AppPermission } from './permissions.js';

/** Minimal PII span shape the anonymizer bridge returns. Kept self-contained so
 *  the SDK doesn't depend on `@moxxy/anonymizer`; the host maps its richer span
 *  onto this. Offsets are into the text the app passed in. */
export interface BridgeSpan {
  readonly start: number;
  readonly end: number;
  readonly category: string;
  /** The replacement the app should substitute (label / pseudonym / hash). */
  readonly replacement: string;
}

/** The typed method map: method name -> its params and result. The host
 *  implements each; the client calls each. Extend here (and add the matching
 *  permission + host handler) to grow the platform. */
export interface BridgeMethods {
  /** Native open dialog -> the picked document's EXTRACTED TEXT (parsed in main:
   *  PDF/Office/ODF/text). `null` when the user cancels. The app never gets a
   *  path. Requires `documents.open`. */
  'documents.open': {
    params: undefined;
    result: { text: string; name: string } | { error: string } | null;
  };
  /** Native save dialog -> writes `content` ONLY where the user points. Returns
   *  the chosen path, or `null` if cancelled. Requires `documents.save`. */
  'documents.save': {
    params: { suggestedName: string; content: string };
    result: { path: string } | null;
  };
  /** Run the on-device structured PII engine (`@moxxy/anonymizer`) — emails,
   *  phones, cards, SSNs, IPs, IBANs, URLs, custom terms. Offline. Requires
   *  `anonymizer.engine`. */
  'anonymizer.detect': {
    params: { text: string; mode?: 'label' | 'pseudonym' | 'hash'; customTerms?: string[] };
    result: { spans: BridgeSpan[] };
  };
}

export type BridgeMethod = keyof BridgeMethods;

/** Permission required for each bridge method — the single source the host gate
 *  checks. A method with no entry is host-internal and never app-callable. */
export const METHOD_PERMISSION: Readonly<Record<BridgeMethod, AppPermission>> = {
  'documents.open': 'documents.open',
  'documents.save': 'documents.save',
  'anonymizer.detect': 'anonymizer.engine',
};

/** Tag on every bridge envelope so unrelated `message` events are ignored. */
export const BRIDGE_TAG = 'moxxy-app-bridge' as const;

/** App -> host: invoke a method. `id` correlates the response. */
export interface BridgeRequest<M extends BridgeMethod = BridgeMethod> {
  readonly __moxxy: typeof BRIDGE_TAG;
  readonly kind: 'request';
  readonly id: number;
  readonly method: M;
  readonly params: BridgeMethods[M]['params'];
}

/** Host -> app: the result of a request (or an error). */
export type BridgeResponse<M extends BridgeMethod = BridgeMethod> = {
  readonly __moxxy: typeof BRIDGE_TAG;
  readonly kind: 'response';
  readonly id: number;
} & (
  | { readonly ok: true; readonly result: BridgeMethods[M]['result'] }
  | { readonly ok: false; readonly error: string }
);

/** Host -> app, once, when the host has wired its listener: the app may start
 *  calling methods. Carries the app's granted permissions so the client can
 *  fail fast on an ungranted call without a round-trip. */
export interface BridgeReady {
  readonly __moxxy: typeof BRIDGE_TAG;
  readonly kind: 'ready';
  readonly permissions: readonly AppPermission[];
}

export type BridgeOutbound = BridgeResponse | BridgeReady;
export type BridgeInbound = BridgeRequest;

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { __moxxy?: unknown }).__moxxy === BRIDGE_TAG &&
    (value as { kind?: unknown }).kind === 'request' &&
    typeof (value as { id?: unknown }).id === 'number' &&
    typeof (value as { method?: unknown }).method === 'string'
  );
}
