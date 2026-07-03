import { defineTool, z, type ToolContext, type ToolDef } from '@moxxy/sdk';
import {
  corePreflight,
  countCorruptCoreTxns,
  listCoreTxns,
  newCoreTxnId,
  provisionWorkspace,
  writeCoreJournal,
  type CoreJournal,
} from '../core-update.js';
import { emitSafe } from '../deps.js';
import { resolveCore, type CoreToolDeps } from './shared.js';

// ── self_update_core_begin ──────────────────────────────────────────────────
export function coreBeginTool(cd: CoreToolDeps): ToolDef {
  const { deps } = cd;
  const scopeDir = resolveCore(cd)?.scopeDir;
  return defineTool({
    name: 'self_update_core_begin',
    description:
      'Start a Tier-2 core patch: provision a source clone pinned to the EXACT installed commit (git clone/fetch + checkout gitHead + pnpm install — this can take minutes) and open a transaction. Returns a coreTxnId and the repo path. Edit files ONLY via self_update_core_write / self_update_core_edit, then self_update_core_verify. Prefer a Tier-1 plugin override first — only patch core when truly unavoidable.',
    inputSchema: z.object({
      packages: z
        .array(z.string().min(1))
        .min(1)
        .describe('Affected @moxxy/* package names, e.g. ["@moxxy/core"].'),
    }),
    permission: { action: 'prompt' },
    // Provisions the pinned source clone under ~/.moxxy/self-update: git
    // clone/fetch from the repo URL in the published @moxxy/core metadata (or
    // the config override) plus a full `pnpm install` — the hosts are
    // genuinely dynamic and first use legitimately takes minutes.
    isolation: {
      capabilities: {
        subprocess: true,
        commands: ['git', 'pnpm'],
        net: { mode: 'any' },
        fs: {
          read: [...(scopeDir ? [`${scopeDir}/**`] : []), `${deps.moxxyDir}/self-update/**`],
          write: [`${deps.moxxyDir}/self-update/**`],
        },
        timeMs: 1_800_000,
      },
    },
    handler: async (input, ctx: ToolContext) => {
      const install = resolveCore(cd);
      if (!install) throw new Error('could not resolve the installed @moxxy/core — cannot self-update core');

      // Fail CLOSED on a corrupt journal: an unparseable in-flight journal would
      // otherwise vanish from listCoreTxns and let this begin clobber the shared
      // repoDir. Refuse rather than risk concurrent overlay corruption.
      const corrupt = await countCorruptCoreTxns(deps.moxxyDir);
      if (corrupt > 0) {
        throw new Error(
          `${corrupt} core-update transaction journal(s) are corrupt/unreadable — refusing to start a ` +
            `new core update (the serialization guard can't see them). Inspect ` +
            `~/.moxxy/self-update/core-txns and resolve them before retrying.`,
        );
      }
      // Serialize core transactions: only ONE may be in flight at a time. Every
      // txn shares the single provisioned workspace (repoDir), so a second
      // concurrent txn would clobber the first's edits + build. Refuse rather
      // than corrupt — the active txn must be finished (verify → commit) or
      // released (self_update_core_rollback, which is a no-op overlay restore +
      // marks it rolled_back even when nothing was applied yet).
      const active = (await listCoreTxns(deps.moxxyDir)).find(
        (j) => j.state !== 'committed' && j.state !== 'rolled_back',
      );
      if (active) {
        throw new Error(
          `a core update is already in progress (txn ${active.txnId}, state "${active.state}"). ` +
            `Finish it (self_update_core_verify → self_update_commit) or release it with ` +
            `self_update_core_rollback({ coreTxnId: "${active.txnId}" }) before starting another.`,
        );
      }

      const pf = await corePreflight(install);
      if (!pf.ok) {
        throw new Error(
          `core update preflight failed: ${pf.checks.filter((c) => !c.ok).map((c) => `${c.id} (${c.detail})`).join('; ')}`,
        );
      }
      const prov = await provisionWorkspace({
        moxxyDir: deps.moxxyDir,
        install,
        ...(deps.coreUpdate?.repoUrlOverride ? { repoUrlOverride: deps.coreUpdate.repoUrlOverride } : {}),
      });
      if (!prov.ok) throw new Error(`provisioning failed (escalate to the user): ${prov.message}`);

      const txnId = newCoreTxnId();
      const journal: CoreJournal = {
        txnId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        packages: [...input.packages],
        version: install.version,
        ...(install.gitHead ? { gitHead: install.gitHead } : {}),
        repoDir: prov.repoDir,
        state: 'provisioned',
        attempts: [],
      };
      await writeCoreJournal(deps.moxxyDir, journal);
      await emitSafe(deps, ctx, 'core_begin', { txnId, packages: journal.packages, version: install.version });
      return {
        coreTxnId: txnId,
        repoDir: prov.repoDir,
        next: 'Edit files under the repo with self_update_core_write / self_update_core_edit (paths relative to the repo), then call self_update_core_verify.',
      };
    },
  });
}
