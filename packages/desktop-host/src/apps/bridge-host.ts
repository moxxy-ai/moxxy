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
 * Electron-free + service-injected so it unit-tests in plain Node (the IPC layer
 * supplies the real dialog/parse/engine services); the gate logic is the part
 * worth testing in isolation.
 */

import {
  METHOD_PERMISSION,
  type AppManifest,
  type AppPermission,
  type BridgeMethod,
  type BridgeMethods,
} from '@moxxy/desktop-app-sdk';

/** The host implementations behind each bridge method. The IPC layer provides
 *  these (native dialogs + main-process parsing + the anonymizer engine); the
 *  gate only calls one after the permission check passes. */
export interface BridgeServices {
  'documents.open': () => Promise<BridgeMethods['documents.open']['result']>;
  'documents.save': (
    p: BridgeMethods['documents.save']['params'],
  ) => Promise<BridgeMethods['documents.save']['result']>;
  'anonymizer.detect': (
    p: BridgeMethods['anonymizer.detect']['params'],
  ) => Promise<BridgeMethods['anonymizer.detect']['result']>;
}

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
  try {
    switch (method) {
      case 'documents.open':
        return { ok: true, result: await services['documents.open']() };
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
