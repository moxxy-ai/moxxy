import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  definePlugin,
  defineTool,
  z,
  type Plugin,
  type SessionId,
  type ToolContext,
  type ToolDef,
  type TurnId,
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
  restoreSnapshot,
  writeJournal,
  type Journal,
  type RegistrySnapshot,
} from './transaction.js';
import { classify, gatherSignals } from './classify.js';
import { verifyPluginBuild, verifySkillFile, type StageResult } from './verify.js';
import {
  corePreflight,
  coreTxnDir,
  detectCoreInstall,
  listCoreTxns,
  newCoreTxnId,
  overlayPackages,
  provisionWorkspace,
  readCoreJournal,
  restoreOverlay,
  safeRepoPath,
  verifyCorePackages,
  writeCoreJournal,
  type CoreInstallInfo,
  type CoreJournal,
} from './core-update.js';

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
  corePreflight,
  type CoreJournal,
  type CoreInstallInfo,
} from './core-update.js';

export interface SkipInfo {
  readonly pluginName: string;
  readonly packageName?: string;
  readonly message: string;
}

export interface SelfUpdateEmit {
  readonly subtype: string;
  readonly payload: unknown;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
}

export interface SelfUpdateDeps {
  /** Base user dir, normally `~/.moxxy`. Overridable for tests. */
  readonly moxxyDir: string;
  /** Hot-reload the plugin host (rescans user plugin dirs). */
  readonly reload: () => Promise<void>;
  /** Unload a plugin by name so a modified version re-imports fresh on reload. */
  readonly unload: (name: string) => Promise<void>;
  /** Current registered contribution names per kind. */
  readonly snapshot: () => RegistrySnapshot;
  /** Plugins the host failed to load (so we can surface a load error). */
  readonly skipped: () => ReadonlyArray<SkipInfo>;
  /** Append a `plugin_event` audit record. Best-effort. */
  readonly emit: (e: SelfUpdateEmit) => Promise<void>;
  /** How many terminal transactions to keep on GC. Default 5. */
  readonly maxTxnRetained?: number;
  /** Tier-2 core-patching config. Omit or set enabled:false to hide core tools. */
  readonly coreUpdate?: {
    /** Enable the Tier-2 core-update tools. Default true. */
    readonly enabled?: boolean;
    /** Module URL used to resolve the live @moxxy/core install. Default import.meta.url. */
    readonly fromUrl?: string;
    /** Override the git repository URL (else read from @moxxy/core package.json). */
    readonly repoUrlOverride?: string;
  };
}

const PLUGIN_ID = '@moxxy/plugin-self-update';

async function readJsonName(dir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as {
      name?: string;
    };
    return pkg.name;
  } catch {
    return undefined;
  }
}

function findSkip(skipped: ReadonlyArray<SkipInfo>, names: ReadonlyArray<string>): SkipInfo | undefined {
  const want = new Set(names.filter(Boolean));
  return skipped.find((s) => want.has(s.pluginName) || (s.packageName ? want.has(s.packageName) : false));
}

async function emitSafe(deps: SelfUpdateDeps, ctx: ToolContext, subtype: string, payload: unknown): Promise<void> {
  await deps
    .emit({ subtype, payload, sessionId: ctx.sessionId, turnId: ctx.turnId })
    .catch(() => undefined);
}

export function buildSelfUpdatePlugin(deps: SelfUpdateDeps): Plugin {
  const tools: ToolDef[] = [
    classifyTool(deps),
    beginTool(deps),
    verifyTool(deps),
    applyTool(deps),
    rollbackTool(deps),
    statusTool(deps),
  ];
  if (deps.coreUpdate?.enabled !== false) tools.push(...coreTools(deps));
  return definePlugin({ name: PLUGIN_ID, version: '0.0.0', tools });
}

function resolveCoreInstall(deps: SelfUpdateDeps): CoreInstallInfo | null {
  return detectCoreInstall(deps.coreUpdate?.fromUrl ?? import.meta.url);
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

// ── Tier 2: core-update tools ──────────────────────────────────────────────────
function coreTools(deps: SelfUpdateDeps): ToolDef[] {
  const snapshotDir = (txnId: string): string => path.join(coreTxnDir(deps.moxxyDir, txnId), 'snapshot');

  const preflight = defineTool({
    name: 'self_update_core_preflight',
    description:
      'Read-only. Check whether a Tier-2 core patch is even possible: git + pnpm present, @moxxy/core resolvable, a pinned source commit (gitHead) and repo URL in its published metadata. Run this BEFORE attempting to patch @moxxy/core; if any check fails, do not start — tell the user.',
    inputSchema: z.object({}),
    permission: { action: 'allow' },
    handler: async () => corePreflight(resolveCoreInstall(deps)),
  });

  const begin = defineTool({
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
    handler: async (input, ctx: ToolContext) => {
      const install = resolveCoreInstall(deps);
      if (!install) throw new Error('could not resolve the installed @moxxy/core — cannot self-update core');

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

  const write = defineTool({
    name: 'self_update_core_write',
    description:
      'Write a file inside the provisioned core clone for a transaction (paths are relative to the repo root and cannot escape it). This is an approval-gated code write — show the user the content first.',
    inputSchema: z.object({
      coreTxnId: z.string().min(1),
      file: z.string().min(1).describe('Path relative to the repo root, e.g. packages/core/src/foo.ts'),
      content: z.string(),
    }),
    permission: { action: 'prompt' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      const abs = safeRepoPath(journal.repoDir, input.file);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, input.content, 'utf8');
      await emitSafe(deps, ctx, 'core_write', { txnId: input.coreTxnId, file: input.file });
      return { ok: true, wrote: input.file };
    },
  });

  const edit = defineTool({
    name: 'self_update_core_edit',
    description:
      'Find-and-replace a unique string in a file inside the provisioned core clone (path relative to the repo root). Approval-gated.',
    inputSchema: z.object({
      coreTxnId: z.string().min(1),
      file: z.string().min(1),
      oldString: z.string().min(1),
      newString: z.string(),
    }),
    permission: { action: 'prompt' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      const abs = safeRepoPath(journal.repoDir, input.file);
      const cur = await fs.readFile(abs, 'utf8');
      const count = cur.split(input.oldString).length - 1;
      if (count === 0) throw new Error(`oldString not found in ${input.file}`);
      if (count > 1) throw new Error(`oldString is not unique in ${input.file} (${count} matches)`);
      await fs.writeFile(abs, cur.replace(input.oldString, input.newString), 'utf8');
      await emitSafe(deps, ctx, 'core_edit', { txnId: input.coreTxnId, file: input.file });
      return { ok: true, edited: input.file };
    },
  });

  const verify = defineTool({
    name: 'self_update_core_verify',
    description:
      'Build, typecheck and test the affected core packages (and their dependents) in the clone, and confirm the patch adds no new runtime dependency. Returns stage results. Run AFTER edits; nothing in the live install changes here.',
    inputSchema: z.object({ coreTxnId: z.string().min(1) }),
    permission: { action: 'prompt' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      const install = resolveCoreInstall(deps);
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

  const apply = defineTool({
    name: 'self_update_core_apply',
    description:
      'Overlay the verified build into the live global install (snapshotting the previous dist for rollback) and stage a restart. The new core code only activates after moxxy restarts. Requires a prior successful self_update_core_verify.',
    inputSchema: z.object({ coreTxnId: z.string().min(1) }),
    permission: { action: 'prompt' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      if (journal.state !== 'verified') {
        throw new Error(`core txn ${input.coreTxnId} is "${journal.state}", not "verified" — run self_update_core_verify first`);
      }
      const install = resolveCoreInstall(deps);
      if (!install) throw new Error('could not resolve @moxxy/core');
      const res = await overlayPackages({
        repo: journal.repoDir,
        install,
        pkgNames: journal.packages,
        snapshotDir: snapshotDir(input.coreTxnId),
      });
      if (!res.ok) {
        await restoreOverlay({ install, pkgNames: journal.packages, snapshotDir: snapshotDir(input.coreTxnId) }).catch(() => undefined);
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

  const rollback = defineTool({
    name: 'self_update_core_rollback',
    description:
      'Undo a core overlay: restore the previous dist from the snapshot. A restart is required to drop the patched code. Use if a core patch built+loaded but misbehaves.',
    inputSchema: z.object({ coreTxnId: z.string().min(1), reason: z.string().optional() }),
    permission: { action: 'allow' },
    handler: async (input, ctx: ToolContext) => {
      const journal = await readCoreJournal(deps.moxxyDir, input.coreTxnId);
      const install = resolveCoreInstall(deps);
      if (!install) throw new Error('could not resolve @moxxy/core');
      await restoreOverlay({ install, pkgNames: journal.packages, snapshotDir: snapshotDir(input.coreTxnId) });
      journal.state = 'rolled_back';
      await writeCoreJournal(deps.moxxyDir, journal);
      await emitSafe(deps, ctx, 'core_rollback', { txnId: input.coreTxnId, reason: input.reason ?? null });
      return { ok: true, restored: journal.packages, restartRequired: true };
    },
  });

  const status = defineTool({
    name: 'self_update_core_status',
    description: 'List Tier-2 core-update transactions and their state.',
    inputSchema: z.object({}),
    permission: { action: 'allow' },
    handler: async () => {
      const all = await listCoreTxns(deps.moxxyDir);
      return {
        transactions: all.map((j) => ({
          coreTxnId: j.txnId,
          state: j.state,
          packages: j.packages,
          version: j.version,
          updatedAt: j.updatedAt,
        })),
      };
    },
  });

  return [preflight, begin, write, edit, verify, apply, rollback, status];
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
