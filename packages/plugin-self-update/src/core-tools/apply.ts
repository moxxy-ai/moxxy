import { defineTool, z, type ToolContext, type ToolDef } from '@moxxy/sdk';
import { overlayPackages, readCoreJournal, restoreOverlay, writeCoreJournal } from '../core-update.js';
import { emitSafe } from '../deps.js';
import { resolveCore, snapshotDir, type CoreToolDeps } from './shared.js';

// ── self_update_core_apply ──────────────────────────────────────────────────
export function coreApplyTool(cd: CoreToolDeps): ToolDef {
  const { deps } = cd;
  const scopeDir = resolveCore(cd)?.scopeDir;
  return defineTool({
    name: 'self_update_core_apply',
    description:
      'Overlay the verified build into the live global install (snapshotting the previous dist for rollback) and stage a restart. The new core code only activates after moxxy restarts. Requires a prior successful self_update_core_verify.',
    inputSchema: z.object({ coreTxnId: z.string().min(1) }),
    permission: { action: 'prompt' },
    // Swaps freshly-built dists into the live @moxxy install (snapshotting the
    // old ones under the txn dir) — writes outside ~/.moxxy by design.
    isolation: {
      capabilities: {
        fs: {
          read: [...(scopeDir ? [`${scopeDir}/**`] : []), `${deps.moxxyDir}/self-update/**`],
          write: [...(scopeDir ? [`${scopeDir}/**`] : []), `${deps.moxxyDir}/self-update/**`],
        },
        net: { mode: 'none' },
        timeMs: 120_000,
      },
    },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      if (journal.state !== 'verified') {
        throw new Error(`core txn ${input.coreTxnId} is "${journal.state}", not "verified" — run self_update_core_verify first`);
      }
      const install = resolveCore(cd);
      if (!install) throw new Error('could not resolve @moxxy/core');
      const res = await overlayPackages({
        repo: journal.repoDir,
        install,
        pkgNames: journal.packages,
        snapshotDir: snapshotDir(deps.moxxyDir, input.coreTxnId),
      });
      if (!res.ok) {
        await restoreOverlay({ install, pkgNames: journal.packages, snapshotDir: snapshotDir(deps.moxxyDir, input.coreTxnId) }).catch(() => undefined);
        throw new Error(`overlay failed and was rolled back: ${res.message}`);
      }
      journal.state = 'staged_restart';
      await writeCoreJournal(deps.moxxyDir, journal);
      await emitSafe(deps, ctx, 'core_apply', { txnId: input.coreTxnId, applied: res.applied });
      return {
        ok: true,
        applied: res.applied,
        restartRequired: true,
        message:
          'Core patch overlaid. RESTART moxxy to activate it (re-run `moxxy`, or it restarts on the next launch under a supervisor). It will be committed automatically on a clean boot; use self_update_core_rollback if needed.',
      };
    },
  });
}
