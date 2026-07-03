import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { corePreflight } from '../core-update.js';
import { resolveCore, type CoreToolDeps } from './shared.js';

// ── self_update_core_preflight ──────────────────────────────────────────────
export function corePreflightTool(cd: CoreToolDeps): ToolDef {
  const scopeDir = resolveCore(cd)?.scopeDir;
  return defineTool({
    name: 'self_update_core_preflight',
    description:
      'Read-only. Check whether a Tier-2 core patch is even possible: git + pnpm present, @moxxy/core resolvable, a pinned source commit (gitHead) and repo URL in its published metadata. Run this BEFORE attempting to patch @moxxy/core; if any check fails, do not start — tell the user.',
    inputSchema: z.object({}),
    permission: { action: 'allow' },
    // Probes `git --version` / `pnpm --version` (10s cap each) and resolves
    // the live install — a package.json read under the @moxxy scope dir.
    isolation: {
      capabilities: {
        subprocess: true,
        commands: ['git', 'pnpm'],
        ...(scopeDir ? { fs: { read: [`${scopeDir}/**`] } } : {}),
        net: { mode: 'none' },
        timeMs: 30_000,
      },
    },
    handler: async () => corePreflight(resolveCore(cd)),
  });
}
