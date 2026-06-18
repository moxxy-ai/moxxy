import { defineTool, z, type ToolContext, type ToolDef } from '@moxxy/sdk';
import { readCoreJournal, restoreOverlay, writeCoreJournal } from '../core-update.js';
import { emitSafe } from '../deps.js';
import { resolveCore, snapshotDir, type CoreToolDeps } from './shared.js';

// ── self_update_core_rollback ───────────────────────────────────────────────
export function coreRollbackTool(cd: CoreToolDeps): ToolDef {
  const { deps } = cd;
  return defineTool({
    name: 'self_update_core_rollback',
    description:
      'Undo a core overlay: restore the previous dist from the snapshot. A restart is required to drop the patched code. Use if a core patch built+loaded but misbehaves.',
    inputSchema: z.object({ coreTxnId: z.string().min(1), reason: z.string().optional() }),
    permission: { action: 'allow' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      const install = resolveCore(cd);
      if (!install) throw new Error('could not resolve @moxxy/core');
      await restoreOverlay({ install, pkgNames: journal.packages, snapshotDir: snapshotDir(deps.moxxyDir, input.coreTxnId) });
      journal.state = 'rolled_back';
      await writeCoreJournal(deps.moxxyDir, journal);
      await emitSafe(deps, ctx, 'core_rollback', { txnId: input.coreTxnId, reason: input.reason ?? null });
      return { ok: true, restored: journal.packages, restartRequired: true };
    },
  });
}
