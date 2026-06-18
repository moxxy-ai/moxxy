import * as path from 'node:path';
import { coreTxnDir } from '../core-update.js';
import { resolveCoreInstall, type SelfUpdateDeps } from '../deps.js';
import type { CoreInstallInfo } from '../core-update.js';

/**
 * Context threaded into every Tier-2 core-tool factory. `fromUrl` is the
 * module URL used to resolve the live `@moxxy/core` install (defaults to the
 * plugin entry's `import.meta.url`, overridable via deps.coreUpdate.fromUrl).
 */
export interface CoreToolDeps {
  readonly deps: SelfUpdateDeps;
  readonly fromUrl: string;
}

/** Where a given core transaction parks its pre-overlay dist snapshot. */
export function snapshotDir(moxxyDir: string, txnId: string): string {
  return path.join(coreTxnDir(moxxyDir, txnId), 'snapshot');
}

/** Resolve the live `@moxxy/core` install for this plugin's deps. */
export function resolveCore(c: CoreToolDeps): CoreInstallInfo | null {
  return resolveCoreInstall(c.deps, c.fromUrl);
}
