import type { ToolDef } from '@moxxy/sdk';
import type { SelfUpdateDeps } from '../deps.js';
import { coreApplyTool } from './apply.js';
import { coreBeginTool } from './begin.js';
import { coreEditTool } from './edit.js';
import { corePreflightTool } from './preflight.js';
import { coreRollbackTool } from './rollback.js';
import type { CoreToolDeps } from './shared.js';
import { coreStatusTool } from './status.js';
import { coreVerifyTool } from './verify.js';
import { coreWriteTool } from './write.js';

export type { CoreToolDeps } from './shared.js';

/**
 * Composes the Tier-2 core-update tools from per-tool factories (mirroring the
 * Tier-1 layout). `fromUrl` is the module URL used to resolve the live
 * `@moxxy/core` install (the plugin entry's `import.meta.url`). Order preserved
 * exactly as before extraction.
 */
export function coreTools(deps: SelfUpdateDeps, fromUrl: string): ToolDef[] {
  const cd: CoreToolDeps = { deps, fromUrl };
  return [
    corePreflightTool(cd),
    coreBeginTool(cd),
    coreWriteTool(cd),
    coreEditTool(cd),
    coreVerifyTool(cd),
    coreApplyTool(cd),
    coreRollbackTool(cd),
    coreStatusTool(cd),
  ];
}
