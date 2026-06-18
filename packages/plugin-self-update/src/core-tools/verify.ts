import { defineTool, z, type ToolContext, type ToolDef } from '@moxxy/sdk';
import { readCoreJournal, verifyCorePackages, writeCoreJournal } from '../core-update.js';
import { emitSafe } from '../deps.js';
import { resolveCore, type CoreToolDeps } from './shared.js';

// ── self_update_core_verify ─────────────────────────────────────────────────
export function coreVerifyTool(cd: CoreToolDeps): ToolDef {
  const { deps } = cd;
  return defineTool({
    name: 'self_update_core_verify',
    description:
      'Build, typecheck and test the affected core packages (and their dependents) in the clone, and confirm the patch adds no new runtime dependency. Returns stage results. Run AFTER edits; nothing in the live install changes here.',
    inputSchema: z.object({ coreTxnId: z.string().min(1) }),
    permission: { action: 'prompt' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      const install = resolveCore(cd);
      if (!install) throw new Error('could not resolve @moxxy/core');
      const res = await verifyCorePackages(journal.repoDir, install, journal.packages);
      journal.attempts.push({
        at: new Date().toISOString(),
        stage: 'verify',
        ok: res.ok,
        message: res.ok ? 'build/typecheck/test ok' : res.stages.find((s) => !s.ok)?.message ?? 'failed',
      });
      journal.state = res.ok ? 'verified' : journal.state;
      await writeCoreJournal(deps.moxxyDir, journal);
      await emitSafe(deps, ctx, res.ok ? 'core_verify_ok' : 'core_verify_failed', { txnId: input.coreTxnId });
      return {
        ok: res.ok,
        stages: res.stages,
        newDeps: res.newDeps,
        next: res.ok
          ? 'Passed — call self_update_core_apply to overlay it into the live install (a restart is then required).'
          : 'Fix the errors and re-verify, or escalate to the user.',
      };
    },
  });
}
