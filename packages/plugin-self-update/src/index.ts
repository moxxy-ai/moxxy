import {
  definePlugin,
  defineTool,
  z,
  type Plugin,
  type ToolContext,
  type ToolDef,
} from '@moxxy/sdk';
import {
  MAX_FAILED_ATTEMPTS,
  beginTransaction,
  diffSnapshot,
  failedAttemptCount,
  gcTransactions,
  listTransactions,
  readJournal,
  recordAttempt,
  resolveTarget,
  restoreSnapshot,
  writeJournal,
  type Journal,
  type RegistrySnapshot,
} from './transaction.js';
import { classify, gatherSignals } from './classify.js';
import { verifyPluginBuild, verifySkillFile, type StageResult } from './verify.js';
import { PLUGIN_ID, emitSafe, findSkip, readJsonName, type SelfUpdateDeps } from './deps.js';
import { coreTools } from './core-tools/index.js';

export type { SelfUpdateDeps, SelfUpdateEmit, SkipInfo } from './deps.js';

export {
  beginTransaction,
  restoreSnapshot,
  listTransactions,
  gcTransactions,
  type Journal,
  type RegistrySnapshot,
} from './transaction.js';
export { classify, gatherSignals, type ClassifyResult } from './classify.js';
export {
  finalizeStagedCoreUpdate,
  listCoreTxns,
  detectCoreInstall,
  readCoreJournal,
  restoreOverlay,
  reconcileOverlay,
  corePreflight,
  type CoreJournal,
  type CoreInstallInfo,
} from './core-update.js';

export function buildSelfUpdatePlugin(deps: SelfUpdateDeps): Plugin {
  const tools: ToolDef[] = [
    classifyTool(deps),
    beginTool(deps),
    verifyTool(deps),
    applyTool(deps),
    rollbackTool(deps),
    statusTool(deps),
  ];
  if (deps.coreUpdate?.enabled !== false) tools.push(...coreTools(deps, import.meta.url));
  return definePlugin({ name: PLUGIN_ID, version: '0.0.0', tools });
}

// ── self_update_classify ────────────────────────────────────────────────────
function classifyTool(deps: SelfUpdateDeps): ToolDef {
  return defineTool({
    name: 'self_update_classify',
    description:
      'Read-only. Inspect recent errors / failed tool calls and the registered tool set, then recommend the LOWEST-risk way to satisfy a self-update: a skill (instructions), a plugin (new tool / behavior override), or a core patch (escalate). Advisory only — you make the final call. Call this first when asked to add a capability or to fix a recurring failure.',
    inputSchema: z.object({
      trigger: z.enum(['error', 'request']).describe('Whether this follows an error or a user request.'),
      text: z.string().optional().describe('The user request or a short description of the problem.'),
    }),
    permission: { action: 'allow' },
    handler: (input, ctx: ToolContext) => {
      const signals = gatherSignals(ctx.log, deps.snapshot().tools ?? []);
      return classify(input, signals);
    },
  });
}

// ── self_update_begin ─────────────────────────────────────────────────────────
function beginTool(deps: SelfUpdateDeps): ToolDef {
  return defineTool({
    name: 'self_update_begin',
    description:
      'Open a self-update transaction for a target plugin (dir under ~/.moxxy/plugins) or skill (~/.moxxy/skills/<name>.md). Snapshots the current state so the change can be rolled back. Returns a txnId. Make your edits with Write/Edit AFTER this, then call self_update_verify.',
    inputSchema: z.object({
      kind: z.enum(['plugin', 'skill']),
      name: z
        .string()
        .min(1)
        .describe('Plugin directory name or skill slug (no path separators).'),
    }),
    permission: { action: 'allow' },
    handler: async (input, ctx: ToolContext) => {
      // Single-flight per target (mirrors the Tier-2 core_begin guard): two
      // concurrent begins on the same plugin/skill snapshot independently, so a
      // second begin started after the model already overwrote the artifact
      // captures the BROKEN state into its own `before/`, and a later rollback
      // of that txn "restores" garbage. Refuse a new begin while a non-terminal
      // txn for the same target is open. resolveTarget also validates the name.
      const target = resolveTarget(deps.moxxyDir, input.kind, input.name);
      const active = (await listTransactions(deps.moxxyDir)).find(
        (j) => j.target.path === target.path && (j.state === 'open' || j.state === 'verified'),
      );
      if (active) {
        throw new Error(
          `a self-update is already in progress for ${input.kind} "${input.name}" ` +
            `(txn ${active.txnId}, state "${active.state}"). Finish it (self_update_verify → ` +
            `self_update_apply) or discard it with self_update_rollback({ txnId: "${active.txnId}" }) ` +
            `before starting another.`,
        );
      }

      const journal = await beginTransaction({ moxxyDir: deps.moxxyDir, kind: input.kind, name: input.name });
      if (input.kind === 'plugin') {
        journal.registryBefore = deps.snapshot();
        await writeJournal(deps.moxxyDir, journal);
      }
      await emitSafe(deps, ctx, 'begin', {
        txnId: journal.txnId,
        target: journal.target,
        existedBefore: journal.existedBefore,
      });
      return {
        txnId: journal.txnId,
        target: journal.target,
        existedBefore: journal.existedBefore,
        next: 'Write/Edit the files, then call self_update_verify with this txnId.',
      };
    },
  });
}

// ── self_update_verify ──────────────────────────────────────────────────────
function verifyTool(deps: SelfUpdateDeps): ToolDef {
  return defineTool({
    name: 'self_update_verify',
    description:
      'Build, test and load-check the change in a transaction, then hot-reload it into the live session. Returns the stage results and what registered. On failure of a modify, the previous working version is automatically restored. Refuses after 2 failed cycles (escalate to the user). Run AFTER your edits; if it passes, call self_update_apply.',
    inputSchema: z.object({ txnId: z.string().min(1) }),
    permission: { action: 'prompt' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readJournal(deps.moxxyDir, input.txnId);

      if (failedAttemptCount(journal) >= MAX_FAILED_ATTEMPTS) {
        await escalate(deps, ctx, journal, 'too many failed verify cycles');
        return {
          ok: false,
          escalate: true,
          message: `Already failed ${MAX_FAILED_ATTEMPTS} times — stopping. Rolled back to a clean state; tell the user what you tried and the errors.`,
          attempts: journal.attempts,
        };
      }

      const result =
        journal.target.kind === 'plugin'
          ? await verifyPlugin(deps, journal)
          : await verifySkill(journal);

      if (!result.ok) {
        recordAttempt(journal, { stage: result.failedStage ?? 'verify', ok: false, message: result.message });
        let recovered = false;
        if (journal.existedBefore) {
          await restoreSnapshot(deps.moxxyDir, journal);
          if (journal.target.kind === 'plugin') {
            await deps.unload(journal.target.name).catch(() => undefined);
            await deps.reload();
          }
          recovered = true;
        }
        const cap = failedAttemptCount(journal) >= MAX_FAILED_ATTEMPTS;
        if (cap) {
          // We may have just restored the snapshot above. Tell escalate() the
          // rollback is done so it doesn't repeat the recursive filesystem copy
          // + plugin-host rescan (escalate skips its restore when already
          // rolled_back). It still flips state to 'escalated' and persists.
          if (recovered) journal.state = 'rolled_back';
          await escalate(deps, ctx, journal, result.message);
        } else {
          await writeJournal(deps.moxxyDir, journal);
        }
        await emitSafe(deps, ctx, 'verify_failed', { txnId: journal.txnId, message: result.message });
        return {
          ok: false,
          escalate: cap,
          recovered,
          stages: result.stages,
          message: result.message,
          remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - failedAttemptCount(journal)),
        };
      }

      recordAttempt(journal, { stage: 'verify', ok: true, message: 'all stages passed' });
      journal.state = 'verified';
      await writeJournal(deps.moxxyDir, journal);
      await emitSafe(deps, ctx, 'verify_ok', { txnId: journal.txnId, registered: result.registered });
      return {
        ok: true,
        stages: result.stages,
        registered: result.registered,
        next: 'Looks good — call self_update_apply to keep it, or self_update_rollback to discard.',
      };
    },
  });
}

interface VerifyOutcome {
  readonly ok: boolean;
  readonly failedStage?: string;
  readonly message: string;
  readonly stages: ReadonlyArray<StageResult>;
  readonly registered?: RegistrySnapshot;
}

async function verifyPlugin(deps: SelfUpdateDeps, journal: Journal): Promise<VerifyOutcome> {
  const target = journal.target;
  const stages = [...(await verifyPluginBuild(target))];
  const failed = stages.find((s) => !s.ok);
  if (failed) {
    return { ok: false, failedStage: failed.stage, message: `${failed.stage} failed: ${failed.message}`, stages };
  }

  // Activate: drop the old instance (if any) so a modified entry re-imports
  // fresh, then rescan from disk.
  await deps.unload(target.name).catch(() => undefined);
  const pkgName = await readJsonName(target.path);
  await deps.reload();

  const skip = findSkip(deps.skipped(), [target.name, pkgName ?? '']);
  if (skip) {
    stages.push({ stage: 'load', ok: false, message: skip.message });
    return { ok: false, failedStage: 'load', message: `plugin failed to load: ${skip.message}`, stages };
  }

  const after = deps.snapshot();
  const registered = diffSnapshot(journal.registryBefore ?? {}, after);
  if (!journal.existedBefore && Object.keys(registered).length === 0) {
    stages.push({
      stage: 'load',
      ok: false,
      message: 'plugin loaded but registered no tools/agents/etc. — check the entry exports a valid plugin',
    });
    return {
      ok: false,
      failedStage: 'load',
      message: 'new plugin registered nothing (no valid contributions found)',
      stages,
    };
  }

  stages.push({ stage: 'load', ok: true, message: 'loaded and registered' });
  return { ok: true, message: 'ok', stages, registered };
}

async function verifySkill(journal: Journal): Promise<VerifyOutcome> {
  const r = await verifySkillFile(journal.target);
  if (!r.ok) return { ok: false, failedStage: r.stage, message: r.message, stages: [r] };
  return {
    ok: true,
    message: 'skill frontmatter valid (activate with reload_skills or on next launch)',
    stages: [r],
  };
}

// ── self_update_apply ───────────────────────────────────────────────────────
function applyTool(deps: SelfUpdateDeps): ToolDef {
  return defineTool({
    name: 'self_update_apply',
    description:
      'Finalize a verified self-update transaction: mark it committed and prune old snapshots. The change is already live (loaded during verify); this is the keep-it confirmation. Requires a prior successful self_update_verify.',
    inputSchema: z.object({ txnId: z.string().min(1) }),
    permission: { action: 'prompt' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readJournal(deps.moxxyDir, input.txnId);
      if (journal.state !== 'verified') {
        throw new Error(
          `transaction ${input.txnId} is "${journal.state}", not "verified" — run self_update_verify first`,
        );
      }
      journal.state = 'committed';
      await writeJournal(deps.moxxyDir, journal);
      await emitSafe(deps, ctx, 'apply', { txnId: journal.txnId, target: journal.target });
      await gcTransactions(deps.moxxyDir, deps.maxTxnRetained ?? 5).catch(() => undefined);
      return { ok: true, committed: journal.target };
    },
  });
}

// ── self_update_rollback ────────────────────────────────────────────────────
function rollbackTool(deps: SelfUpdateDeps): ToolDef {
  return defineTool({
    name: 'self_update_rollback',
    description:
      'Undo a self-update transaction: restore the pre-change snapshot (or delete a newly-created artifact) and hot-reload. Use when a change built and loaded cleanly but behaves wrongly at runtime.',
    inputSchema: z.object({
      txnId: z.string().min(1),
      reason: z.string().optional(),
    }),
    permission: { action: 'allow' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readJournal(deps.moxxyDir, input.txnId);
      await restoreSnapshot(deps.moxxyDir, journal);
      if (journal.target.kind === 'plugin') {
        await deps.unload(journal.target.name).catch(() => undefined);
        await deps.reload();
      }
      journal.state = 'rolled_back';
      await writeJournal(deps.moxxyDir, journal);
      await emitSafe(deps, ctx, 'rollback', { txnId: journal.txnId, reason: input.reason ?? null });
      return { ok: true, restored: journal.target, existedBefore: journal.existedBefore };
    },
  });
}

// ── self_update_status ──────────────────────────────────────────────────────
function statusTool(deps: SelfUpdateDeps): ToolDef {
  return defineTool({
    name: 'self_update_status',
    description: 'List self-update transactions and their state (open / verified / committed / rolled_back / escalated).',
    inputSchema: z.object({ txnId: z.string().optional() }),
    permission: { action: 'allow' },
    handler: async (input) => {
      const all = await listTransactions(deps.moxxyDir);
      const rows = (input.txnId ? all.filter((j) => j.txnId === input.txnId) : all).map((j) => ({
        txnId: j.txnId,
        state: j.state,
        target: j.target,
        existedBefore: j.existedBefore,
        failedAttempts: failedAttemptCount(j),
        updatedAt: j.updatedAt,
      }));
      return { transactions: rows };
    },
  });
}

async function escalate(deps: SelfUpdateDeps, ctx: ToolContext, journal: Journal, reason: string): Promise<void> {
  if (journal.existedBefore && journal.state !== 'rolled_back') {
    await restoreSnapshot(deps.moxxyDir, journal);
    if (journal.target.kind === 'plugin') {
      await deps.unload(journal.target.name).catch(() => undefined);
      await deps.reload();
    }
  } else if (!journal.existedBefore) {
    // Clean up the failed new artifact so it doesn't linger half-built.
    await restoreSnapshot(deps.moxxyDir, journal);
    if (journal.target.kind === 'plugin') await deps.reload();
  }
  journal.state = 'escalated';
  await writeJournal(deps.moxxyDir, journal);
  await emitSafe(deps, ctx, 'escalated', { txnId: journal.txnId, reason });
}
