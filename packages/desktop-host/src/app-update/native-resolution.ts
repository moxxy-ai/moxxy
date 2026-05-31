/**
 * A hot-updated bundle's main lives under `<userData>/app/<version>/` and has no
 * `node_modules` of its own. Everything it needs is inlined into its `index.js`
 * EXCEPT two bare specifiers: `electron` (always injected by the runtime) and
 * the OPTIONAL native `@napi-rs/keyring` (loaded via a guarded dynamic import,
 * with a passphrase fallback). To let that optional native dep still resolve
 * from the shell's ABI-matched copy, append the shell's `node_modules` to the
 * module search path.
 *
 * Node built-ins only (so this is safe to bake into the bootstrap). Append, not
 * prepend, so nothing a bundle ships can be shadowed; fully guarded so a missing
 * dir or an absent internal API is a harmless no-op.
 */

import { existsSync } from 'node:fs';
import path, { delimiter } from 'node:path';
import Module from 'node:module';

export function setupNativeResolution(floorRoot: string): void {
  try {
    const candidates = [
      path.join(floorRoot, 'node_modules'),
      // electron-builder unpacks native modules beside app.asar.
      path.join(floorRoot, '..', 'app.asar.unpacked', 'node_modules'),
    ].filter((p) => existsSync(p));
    if (candidates.length === 0) return;

    const extra = candidates.join(delimiter);
    process.env.NODE_PATH = process.env.NODE_PATH
      ? `${process.env.NODE_PATH}${delimiter}${extra}`
      : extra;
    // Re-seed the global module paths from the updated NODE_PATH. `_initPaths`
    // is internal/undocumented — guarded so a Node that drops it can't break boot.
    (Module as unknown as { _initPaths?: () => void })._initPaths?.();
  } catch {
    /* best effort — keychain degrades to the passphrase fallback if unresolved */
  }
}
