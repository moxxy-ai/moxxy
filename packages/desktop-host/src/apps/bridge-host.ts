/**
 * The host side of the app<->host bridge: the capability GATE.
 *
 * A sandboxed app posts a {@link BridgeRequest} (it reaches the host renderer,
 * which forwards it here over IPC with the app's id). Before ANY host service
 * runs, this checks two things against the app's discovered manifest:
 *   1. the requested `method` is a known bridge method, and
 *   2. the permission that method requires is in the app's declared
 *      `manifest.permissions`.
 * A request for a method the app didn't declare is refused with a clear error —
 * never executed. So the manifest the user consented to at install is the
 * complete, enforced grant list; a compromised app's UI can't reach a capability
 * it wasn't granted by forging a different method name.
 *
 * Some bridge methods are RENDERER-DISPATCHED (see `RENDERER_DISPATCHED_METHODS`
 * in the SDK) — they're resolved in the host renderer (e.g. `session.send`
 * prefills the active chat composer) and should never reach this main-process
 * gate. This gate refuses them by design, so a forged direct-to-main dispatch
 * can't reach a service that doesn't exist here.
 *
 * Electron-free + service-injected so it unit-tests in plain Node (the IPC layer
 * supplies the real dialog/parse/engine services); the gate logic is the part
 * worth testing in isolation.
 */

import {
  METHOD_PERMISSION,
  isRendererDispatched,
  type AppManifest,
  type AppPermission,
  type BridgeMethod,
  type BridgeMethods,
  type HostDispatchedMethod,
} from '@moxxy/desktop-app-sdk';

/** The host implementations behind each bridge method. The IPC layer provides
 *  these (native dialogs + main-process parsing + the anonymizer engine); the
 *  gate only calls one after the permission check passes.
 *
 *  Keyed by {@link HostDispatchedMethod} so the DISJOINT + EXHAUSTIVE invariant
 *  with `RENDERER_DISPATCHED_METHODS` (SDK) is compile-enforced: every
 *  host-dispatched method MUST have a service here, and a renderer-dispatched
 *  method (e.g. `session.send`) CANNOT appear as a key. */
export type BridgeServices = {
  [M in HostDispatchedMethod]: (
    params: BridgeMethods[M]['params'],
  ) => Promise<BridgeMethods[M]['result']>;
};

export type BridgeDispatchResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string };

function isKnownMethod(method: string): method is BridgeMethod {
  return Object.prototype.hasOwnProperty.call(METHOD_PERMISSION, method);
}

function granted(manifest: AppManifest, perm: AppPermission): boolean {
  return manifest.permissions.includes(perm);
}

/**
 * Validate + dispatch one bridge request for the app described by `manifest`.
 * Never throws — a refused permission, an unknown method, or a service error all
 * come back as `{ ok: false, error }` so the IPC layer relays a clean response
 * to the app instead of a crash.
 */
export async function dispatchBridge(
  manifest: AppManifest,
  method: string,
  params: unknown,
  services: BridgeServices,
): Promise<BridgeDispatchResult> {
  if (!isKnownMethod(method)) {
    return { ok: false, error: `unknown bridge method: ${method}` };
  }
  const need = METHOD_PERMISSION[method];
  if (!granted(manifest, need)) {
    return {
      ok: false,
      error: `app "${manifest.id}" is not permitted to call ${method} (needs "${need}")`,
    };
  }
  // Renderer-dispatched methods (e.g. session.send) have no main-process
  // service; the renderer relay resolves them locally and never forwards them
  // here. If one reaches main anyway, refuse it rather than fall through.
  if (isRendererDispatched(method)) {
    return {
      ok: false,
      error: `bridge method ${method} is handled in the renderer, not the main process`,
    };
  }
  try {
    switch (method) {
      case 'documents.open':
        // `documents.open` takes no params (its map entry is `undefined`); the
        // host service signature carries that `undefined` slot, so pass it.
        return { ok: true, result: await services['documents.open'](undefined) };
      case 'documents.save':
        return {
          ok: true,
          result: await services['documents.save'](
            params as BridgeMethods['documents.save']['params'],
          ),
        };
      case 'anonymizer.detect':
        return {
          ok: true,
          result: await services['anonymizer.detect'](
            params as BridgeMethods['anonymizer.detect']['params'],
          ),
        };
      case 'session.send':
        // Renderer-dispatched: no main service exists. Already refused above by
        // the isRendererDispatched guard; this case keeps the exhaustive switch
        // honest (and refuses defensively even if that guard were removed).
        return {
          ok: false,
          error: 'session.send is renderer-dispatched and has no main service',
        };
      default: {
        // Exhaustiveness guard: a new BridgeMethod added to the SDK without a
        // case here is a compile error, not a silent passthrough.
        const _never: never = method;
        return { ok: false, error: `unhandled bridge method: ${String(_never)}` };
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
