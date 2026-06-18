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
   *  or with the host's error message on failure. */
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
}

/**
 * Connect to the host. Resolves once the host's `ready` handshake arrives (so
 * the granted permission set is known). Rejects if no host responds within
 * `timeoutMs` — i.e. the bundle was opened outside the desktop sandbox.
 */
export function connectMoxxyApp(timeoutMs = 8000): Promise<MoxxyApp> {
  const parent = window.parent;
  if (!parent || parent === window) {
    return Promise.reject(new Error('not running inside the moxxy app host'));
  }

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  let granted: readonly AppPermission[] | null = null;

  return new Promise<MoxxyApp>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      rejectReady(new Error('moxxy app host did not respond'));
    }, timeoutMs);

    const onMessage = (e: MessageEvent): void => {
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
        pending.delete(data.id);
        if (data.ok) waiter.resolve(data.result);
        else waiter.reject(new Error(data.error));
      }
    };
    window.addEventListener('message', onMessage);

    function call<M extends BridgeMethod>(
      method: M,
      params: BridgeMethods[M]['params'],
    ): Promise<BridgeMethods[M]['result']> {
      const need = METHOD_PERMISSION[method];
      if (!granted || !granted.includes(need)) {
        return Promise.reject(
          new Error(`this app is not permitted to call ${method} (needs "${need}")`),
        );
      }
      const id = nextId++;
      const req: BridgeRequest<M> = { __moxxy: BRIDGE_TAG, kind: 'request', id, method, params };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        // Target the host origin loosely ('*') — the iframe only ever has ONE
        // parent (the host renderer), and the host validates the source frame +
        // app id on its side. No secrets travel in params.
        parent.postMessage(req, '*');
      });
    }

    function makeApp(): MoxxyApp {
      return {
        permissions: granted ?? [],
        call,
        openDocument: () => call('documents.open', undefined),
        saveDocument: (suggestedName, content) =>
          call('documents.save', { suggestedName, content }),
      };
    }
  });
}
