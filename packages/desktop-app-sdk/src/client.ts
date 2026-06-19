/**
 * The app-side bridge client. A mini-app's web bundle imports
 * `@moxxy/desktop-app-sdk/client`, calls {@link connectMoxxyApp}, and then uses
 * typed promises — `await moxxy.openDocument()` — instead of hand-rolling
 * `postMessage`. Everything is funnelled to the host renderer (the iframe
 * parent), correlated by an incrementing id, and resolved when the matching
 * response arrives. A call to a method the app didn't get permission for rejects
 * immediately (the host told us the grant set in the ready handshake), without a
 * round-trip.
 *
 * This file is the ONLY part of the SDK that touches `window`, so apps that only
 * need the manifest types never pull DOM globals in.
 */

import {
  BRIDGE_TAG,
  METHOD_PERMISSION,
  type BridgeMethod,
  type BridgeMethods,
  type BridgeOutbound,
  type BridgeRequest,
} from './bridge.js';
import type { AppPermission } from './permissions.js';

export interface MoxxyApp {
  /** Capabilities the host granted this app (its manifest's `permissions`). */
  readonly permissions: readonly AppPermission[];
  /** Invoke a bridge method. Rejects if the method's permission wasn't granted,
   *  with the host's error message on failure, or after `callTimeoutMs` if the
   *  host never answers. */
  call<M extends BridgeMethod>(
    method: M,
    params: BridgeMethods[M]['params'],
  ): Promise<BridgeMethods[M]['result']>;
  /** Sugar for the common methods. */
  openDocument(): Promise<BridgeMethods['documents.open']['result']>;
  saveDocument(
    suggestedName: string,
    content: string,
  ): Promise<BridgeMethods['documents.save']['result']>;
  /** Hand a payload to the user's active chat (review-in-composer): it prefills
   *  the composer and shows the chat view for the user to review + send. Needs
   *  the `session.send` permission. */
  sendToSession(
    payload: BridgeMethods['session.send']['params'],
  ): Promise<BridgeMethods['session.send']['result']>;
  /** Tear down the bridge: remove the host message listener and reject every
   *  in-flight call. Idempotent. Use when an SPA unmounts/reconnects so the
   *  listener and pending promises don't leak. */
  disconnect(): void;
}

export interface ConnectOptions {
  /** Reject the connect handshake if no host responds within this many ms. */
  timeoutMs?: number;
  /** Reject an individual {@link MoxxyApp.call} if the host never answers within
   *  this many ms (so a dropped message / crashed relay can't strand a pending
   *  entry and hang the awaiting UI forever). */
  callTimeoutMs?: number;
}

/**
 * Connect to the host. Resolves once the host's `ready` handshake arrives (so
 * the granted permission set is known). Rejects if no host responds within
 * `timeoutMs` — i.e. the bundle was opened outside the desktop sandbox.
 *
 * Accepts either a bare `timeoutMs` (back-compat) or a {@link ConnectOptions}.
 */
export function connectMoxxyApp(opts: number | ConnectOptions = {}): Promise<MoxxyApp> {
  const { timeoutMs = 8000, callTimeoutMs = 30_000 } =
    typeof opts === 'number' ? { timeoutMs: opts } : opts;

  const parent = window.parent;
  if (!parent || parent === window) {
    return Promise.reject(new Error('not running inside the moxxy app host'));
  }

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let granted: readonly AppPermission[] | null = null;
  let disconnected = false;

  return new Promise<MoxxyApp>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      rejectReady(new Error('moxxy app host did not respond'));
    }, timeoutMs);

    const onMessage = (e: MessageEvent): void => {
      // Isolation: the app talks ONLY to its host parent. Drop any frame that
      // isn't the parent window (a nested iframe the app loads, `window.opener`,
      // or any other holder of this window's handle) BEFORE reading the payload,
      // so a forged `ready` can't inject a grant set and a forged `response`
      // can't resolve a pending call with attacker-controlled data.
      if (e.source !== parent) return;
      const data = e.data as BridgeOutbound | undefined;
      if (!data || data.__moxxy !== BRIDGE_TAG) return;

      if (data.kind === 'ready') {
        if (granted) return; // already connected; ignore duplicates
        granted = data.permissions;
        clearTimeout(timer);
        resolveReady(makeApp());
        return;
      }
      if (data.kind === 'response') {
        const waiter = pending.get(data.id);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        pending.delete(data.id);
        // `data` is untrusted (postMessage): treat anything that isn't an
        // explicit `ok: true` as a failure, and never surface `Error(undefined)`.
        if (data.ok === true) waiter.resolve(data.result);
        else {
          const msg =
            typeof (data as { error?: unknown }).error === 'string' &&
            (data as { error?: string }).error
              ? (data as { error: string }).error
              : 'bridge call failed';
          waiter.reject(new Error(msg));
        }
      }
    };
    window.addEventListener('message', onMessage);

    function call<M extends BridgeMethod>(
      method: M,
      params: BridgeMethods[M]['params'],
    ): Promise<BridgeMethods[M]['result']> {
      if (disconnected) {
        return Promise.reject(new Error('moxxy app bridge is disconnected'));
      }
      const need = METHOD_PERMISSION[method];
      if (!granted || !granted.includes(need)) {
        return Promise.reject(
          new Error(`this app is not permitted to call ${method} (needs "${need}")`),
        );
      }
      const id = nextId++;
      const req: BridgeRequest<M> = { __moxxy: BRIDGE_TAG, kind: 'request', id, method, params };
      return new Promise((resolve, reject) => {
        // Bound every call: if the host drops the message / crashes mid-request /
        // the app id is revoked, settle (reject) and reclaim the pending entry so
        // it can't leak unboundedly or hang the awaiting UI forever.
        const callTimer = setTimeout(() => {
          if (pending.delete(id)) {
            reject(new Error(`bridge call ${method} timed out after ${callTimeoutMs}ms`));
          }
        }, callTimeoutMs);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer: callTimer });
        // Target the host origin loosely ('*') — the iframe only ever has ONE
        // parent (the host renderer), and the host validates the source frame +
        // app id on its side. No secrets travel in params.
        parent.postMessage(req, '*');
      });
    }

    function disconnect(): void {
      if (disconnected) return;
      disconnected = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      for (const [, waiter] of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('moxxy app bridge disconnected'));
      }
      pending.clear();
    }

    function makeApp(): MoxxyApp {
      return {
        permissions: granted ?? [],
        call,
        openDocument: () => call('documents.open', undefined),
        saveDocument: (suggestedName, content) =>
          call('documents.save', { suggestedName, content }),
        sendToSession: (payload) => call('session.send', payload),
        disconnect,
      };
    }
  });
}
