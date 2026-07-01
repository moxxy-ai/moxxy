/**
 * The coordinator. Runs inside the user's Session as the `collaborative` mode:
 * spawns an architect to design the plan + contracts, gets the roster approved,
 * then spawns implementer processes — in parallel git worktrees when git is
 * available, or SEQUENTIALLY in the single workspace when it isn't (desktop
 * users without git). It hosts the hub, relays its events to the user's log for
 * the UI, integrates the work, and synthesizes the result.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ModeContext, MoxxyEvent } from '@moxxy/sdk';
import {
  createCollaborationHub,
  registerActiveHub,
  unregisterActiveHub,
  type CollabEvent,
  type RosterEntry,
} from '@moxxy/plugin-collab';
import {
  ARCHITECT_AGENT_ID,
  COLLAB_ARCHITECT_MODE_NAME,
  COLLAB_PEER_MODE_NAME,
  COLLAB_PLUGIN_ID,
  COLLAB_SCAFFOLD_DIR,
  BRIEF_FILENAME,
  CONVERSATION_FILENAME,
  ROSTER_FILENAME,
  charterFilePath,
  collabBranch,
  collabRunDir,
  collabRunId,
  hubSocketPath,
  worktreePath,
  worktreeRoot,
} from './constants.js';
import { resolveCollabConfig, type CollabConfig } from './config.js';
import { buildBrief, buildConversation, heuristicSummary } from './brief.js';
import { summarizeConversation } from './summarize.js';
import { writeRunRecord, type CollabRunRecord } from './archive.js';
import {
  addWorktree,
  commitAll,
  cwdPeerReader,
  detectGit,
  git,
  headSha,
  peerReaderFor,
  removeWorktree,
  resolveBase,
  tryInitGitRepo,
} from './worktrees.js';
import { PeerSupervisor, type PeerSupervisorOptions, type Supervisor } from './peer-supervisor.js';
import { integrate } from './integrate.js';
import { releaseCollabLock, tryAcquireCollabLock } from './collab-lock.js';
import type { CollaborationHub } from '@moxxy/plugin-collab';

const POLL_MS = 500;
/** Grace for a spawned agent to boot + register with the hub. Separate from the
 *  overall wall-clock so a peer that never comes up (bad spawn, crash on boot)
 *  fails in ~a minute instead of hanging the whole run for the wall-clock. */
const BOOT_DEADLINE_MS = 90_000;

/** Injection seam — defaults to the real process supervisor + the live cwd/config.
 *  Lets tests (and future remote executors) drive the coordinator deterministically. */
export interface CollabDeps {
  readonly cwd?: string;
  readonly config?: CollabConfig;
  /** One-line override for `concurrency` without a full config (tests + a future
   *  desktop pref). Ignored when `config` is provided. */
  readonly concurrencyOverride?: 'parallel' | 'sequential';
  /** Injection seam — defaults to the real git detector. Lets a test force the
   *  no-git (cwd-parallel) path deterministically even where git is installed. */
  readonly detectGit?: (cwd: string) => Promise<{ installed: boolean; repo: boolean }>;
  readonly createSupervisor?: (opts: PeerSupervisorOptions, hub: CollaborationHub) => Supervisor;
}

/** The user-selectable mode entrypoint. */
export function runCollaborativeMode(ctx: ModeContext): AsyncIterable<MoxxyEvent> {
  return runCollaborative(ctx, {});
}

export async function* runCollaborative(ctx: ModeContext, deps: CollabDeps): AsyncIterable<MoxxyEvent> {
  if (ctx.signal.aborted) {
    yield await ctx.emit(emitAbort(ctx, 'aborted before collaboration start'));
    return;
  }

  const cfg =
    deps.config ??
    resolveCollabConfig(undefined, deps.concurrencyOverride ? { concurrency: deps.concurrencyOverride } : undefined);
  const cwd = deps.cwd ?? process.cwd();
  const task = lastUserPromptText(ctx) ?? '';
  if (!task.trim()) {
    yield await ctx.emit(assistant(ctx, 'Collaborative mode needs a task to work on.'));
    return;
  }

  // Global single-flight: only one collaboration runs at a time (each spawns a
  // fleet of agent processes). Refuse rather than thrash resources.
  // The coordinator now runs as its own headless runner process (`moxxy collab`),
  // which sets MOXXY_RUNNER_SOCKET to its own socket. Record it in the lock so a
  // UI can discover where to attach without knowing the run id.
  const lock = tryAcquireCollabLock({
    sessionId: String(ctx.sessionId),
    task,
    startedAtMs: Date.now(),
    runnerSocket: process.env.MOXXY_RUNNER_SOCKET?.trim() || '',
  });
  if (!lock.ok) {
    yield await ctx.emit(plugin(ctx, 'collab_blocked', { reason: 'already-running', holderTask: lock.holder.task }));
    yield await ctx.emit(
      assistant(
        ctx,
        `A collaboration is already running ("${lock.holder.task}"). Only one runs at a time to save resources — stop it first, then start again.`,
      ),
    );
    return;
  }

  const runId = collabRunId(String(ctx.sessionId), String(ctx.turnId));
  const startedAtMs = Date.now();
  const worktrees = new Map<string, string>();
  let hub: CollaborationHub | null = null;
  let supervisor: Supervisor | null = null;
  let unsubscribe: (() => void) | null = null;
  // Captured through the run so the finally can archive it on EVERY exit path
  // (completed, aborted, or failed), not just the happy one.
  let archiveParallel = false;
  let archiveGitRepo = false;
  let briefText = '';
  let mergeForArchive: CollabRunRecord['merge'];
  let completed = false;
  try {
    mkdirSync(collabRunDir(runId), { recursive: true });

  // GIT-FIRST execution. We prefer the git-worktree path (true isolation + a
  // clean, conflict-aware merge). If this folder isn't a git repo yet, quietly
  // try to make it one so it STILL gets that — so most "plain folder" runs get
  // full isolation. Only when git genuinely can't be used (not installed, or
  // init/commit throws) do we fall back to running the team in PARALLEL directly
  // in the shared workspace, coordinated by the file-lock board. The user never
  // sees git/worktree/lock jargon — the engine just picks the safest mechanism.
  const { installed: gitInstalled, repo: alreadyGitRepo } = await (deps.detectGit ?? detectGit)(cwd);
  let gitRepo = alreadyGitRepo;
  if (!gitRepo && gitInstalled && cfg.concurrency !== 'sequential') {
    gitRepo = await tryInitGitRepo(cwd).catch(() => false);
  }
  const execMode = resolveExecMode(cfg, gitRepo);
  const usesGit = execMode === 'git-parallel';
  const runsParallel = execMode !== 'sequential';
  archiveParallel = runsParallel;
  archiveGitRepo = gitRepo;
  // Internal diagnostic (not user-facing jargon). Keep the legacy
  // collab_fallback_sequential ONLY for the explicit sequential mode, so the
  // existing UI + tests still observe it where it still applies.
  yield await ctx.emit(plugin(ctx, 'collab_exec_mode', { mode: execMode, gitInstalled, gitRepo }));
  if (execMode === 'sequential') {
    yield await ctx.emit(plugin(ctx, 'collab_fallback_sequential', { reason: 'sequential mode — one agent at a time' }));
  }

  // Base commit (git path only). A dirty tree is snapshotted so work is never lost.
  let baseSha = '';
  if (usesGit) {
    const base = await resolveBase(cwd, { snapshotDirty: true });
    baseSha = base.baseSha;
  }

  const architectEntry: RosterEntry = {
    id: ARCHITECT_AGENT_ID,
    name: 'Architect',
    role: 'architect',
    subtask: task,
  };

  hub = await createCollaborationHub({
    socketPath: hubSocketPath(runId),
    task,
    roster: [architectEntry],
    // git: read each agent's worktree. non-git: every agent shares one tree, so
    // peer-read is just "read the live shared workspace".
    peerReader: usesGit ? peerReaderFor(worktrees, baseSha) : cwdPeerReader(cwd),
  });
  registerActiveHub(String(ctx.sessionId), hub);
  unsubscribe = hub.subscribe((e) => {
    void ctx.emit(toCollabEvent(ctx, e));
  });

  const providerModelIds = modelIdCatalog(ctx);
  const peerDefaultModel = resolvePeerModel(cfg.defaultModel, ctx.model, providerModelIds);
  const supervisorOpts: PeerSupervisorOptions = {
    runId,
    hubSocket: hub.socketPath,
    coordinatorSessionId: String(ctx.sessionId),
    parentTask: task,
    ...(peerDefaultModel ? { defaultModel: peerDefaultModel } : {}),
    peerMaxIterations: cfg.peerMaxIterations,
    signal: ctx.signal,
  };
  supervisor = (deps.createSupervisor ?? ((o) => new PeerSupervisor(o)))(supervisorOpts, hub);

    // Keep `parallel` (the chat-model folder binds it) — cwd-parallel IS parallel
    // — and add execMode for finer-grained consumers.
    yield await ctx.emit(plugin(ctx, 'collab_started', { task, parallel: runsParallel, execMode, gitInstalled, gitRepo }));

    // Distil the user's conversation for the whole team. BRIEF.md is a CONCISE
    // SUMMARY (goal + key requirements/constraints/decisions) — one coordinator
    // LLM call, with a deterministic heuristic fallback — so the N peers don't
    // each re-ingest the raw transcript. The full conversation goes to
    // CONVERSATION.md for on-demand recall (never auto-loaded). BOTH are written
    // here, before the architect spawns + before the scaffold commit, so the
    // architect reads them and worktrees inherit them. Best-effort throughout: a
    // brief failure must never sink the run.
    try {
      const events = ctx.log.slice();
      mkdirSync(join(cwd, COLLAB_SCAFFOLD_DIR), { recursive: true });
      writeFileSync(join(cwd, COLLAB_SCAFFOLD_DIR, CONVERSATION_FILENAME), buildConversation(task, events));
      const llmSummary = await summarizeConversation({
        task,
        events,
        provider: ctx.provider,
        model: ctx.model,
        signal: ctx.signal,
      }).catch(() => null);
      const summary = llmSummary ?? heuristicSummary(task, events);
      briefText = buildBrief(task, summary);
      writeFileSync(join(cwd, COLLAB_SCAFFOLD_DIR, BRIEF_FILENAME), briefText);
      yield await ctx.emit(
        plugin(ctx, 'collab_brief_written', {
          path: join(COLLAB_SCAFFOLD_DIR, BRIEF_FILENAME),
          conversationPath: join(COLLAB_SCAFFOLD_DIR, CONVERSATION_FILENAME),
          summarized: Boolean(llmSummary),
        }),
      );
    } catch {
      // brief is an enhancement, not a prerequisite
    }

    // --- Phase 0: architect designs the plan + contracts (runs in cwd) ---
    supervisor.spawn({ entry: architectEntry, cwd, mode: COLLAB_ARCHITECT_MODE_NAME });
    yield await ctx.emit(plugin(ctx, 'collab_agent_spawned', { id: ARCHITECT_AGENT_ID, role: 'architect' }));

    const architectOk = await waitForAgent(hub, supervisor, ARCHITECT_AGENT_ID, ctx.signal, cfg.wallClockMs);
    if (ctx.signal.aborted) {
      yield await ctx.emit(emitAbort(ctx, 'aborted during design'));
      return;
    }
    if (!architectOk) {
      const why = supervisor.stderrOf(ARCHITECT_AGENT_ID).slice(-4).join('\n');
      yield await ctx.emit(plugin(ctx, 'collab_agent_failed', { id: ARCHITECT_AGENT_ID, status: statusOf(hub, ARCHITECT_AGENT_ID), stderr: supervisor.stderrOf(ARCHITECT_AGENT_ID).slice(-6) }));
      yield await ctx.emit(
        assistant(
          ctx,
          `The architect did not finish the design — stopping the collaboration.${why ? `\n\nLast diagnostics:\n${why}` : ''}`,
        ),
      );
      return;
    }

    // --- Roster: read the architect's proposal, get user approval ---
    let roster = readRoster(join(cwd, COLLAB_SCAFFOLD_DIR, ROSTER_FILENAME), cfg.maxAgents);
    if (roster.length === 0) {
      roster = [{ id: 'implementer', name: 'Implementer', role: 'implementer', subtask: task }];
    }
    roster = resolveRosterModels(roster, peerDefaultModel, providerModelIds);
    yield await ctx.emit(plugin(ctx, 'collab_roster_proposed', { roster }));

    if (cfg.requireRosterApproval && ctx.approval) {
      const decision = await ctx.approval.confirm({
        title: `Team of ${roster.length} agent${roster.length === 1 ? '' : 's'} — review before launch`,
        body: roster
          .map((r, i) => {
            // Surface a clipped charter preview — the architect-authored charter
            // becomes the agent's system prompt, so the human roster review is the
            // gate on that injected text. Strip newlines so one charter can't swamp
            // the dialog.
            const charterLine = r.charter
              ? `\n    charter: ${r.charter.replace(/\s+/g, ' ').slice(0, 140)}${r.charter.length > 140 ? '…' : ''}`
              : '';
            return `${i + 1}. [${r.id}] ${r.name} — ${r.role}\n    ${r.subtask}${charterLine}`;
          })
          .join('\n\n'),
        kind: 'collab.roster',
        defaultOptionId: 'launch',
        options: [
          { id: 'launch', label: 'Launch the team', hotkey: 'l' },
          { id: 'cancel', label: 'Cancel', hotkey: 'c', danger: true },
        ],
      });
      if (decision.optionId === 'cancel') {
        yield await ctx.emit(assistant(ctx, 'Collaboration cancelled before launch.'));
        return;
      }
    }
    yield await ctx.emit(plugin(ctx, 'collab_roster_confirmed', { roster }));

    // Commit the scaffold (CONTRACTS.md, roster.json, any stubs) so worktrees
    // inherit it. Non-git: the scaffold + brief are already physically in cwd, so
    // every shared-workspace peer sees them with no commit/checkout.
    if (usesGit) {
      await commitAll(cwd, 'moxxy-collab: scaffold contracts');
      baseSha = await headSha(cwd);
      mkdirSync(worktreeRoot(runId), { recursive: true });
    }

    // --- Phase 1: implementers ---
    const doneIds: string[] = [];
    if (execMode === 'git-parallel') {
      for (const entry of roster) {
        hub.state.addAgent(entry);
        const wt = worktreePath(runId, entry.id);
        await addWorktree({ repoCwd: cwd, path: wt, branch: collabBranch(runId, entry.id), baseSha });
        worktrees.set(entry.id, wt);
        const charterFile = writeCharterFile(runId, entry);
        supervisor.spawn({ entry, cwd: wt, mode: COLLAB_PEER_MODE_NAME, ...(charterFile ? { charterFile } : {}) });
        yield await ctx.emit(plugin(ctx, 'collab_agent_spawned', { id: entry.id, role: entry.role }));
      }
      await waitForAgents(hub, supervisor, roster.map((r) => r.id), ctx.signal, cfg.wallClockMs);
      yield* surfaceFailures(ctx, hub, supervisor, roster.map((r) => r.id));
      for (const r of roster) if (statusOf(hub, r.id) === 'done') doneIds.push(r.id);
    } else if (execMode === 'cwd-parallel') {
      // No git: run the whole team in parallel directly in the shared workspace,
      // coordinated by the file-lock board. Pre-seed each agent's declared
      // ownedPaths as a claim so ownership is enforced from the very first edit;
      // an overlap means the architect mis-decomposed — surface it but still run.
      for (const entry of roster) {
        hub.state.addAgent(entry);
        if (entry.ownedPaths?.length) {
          const res = hub.state.boardClaim(entry.id, entry.ownedPaths);
          if (!res.ok) {
            yield await ctx.emit(
              plugin(ctx, 'collab_ownership_overlap', { id: entry.id, paths: entry.ownedPaths, ownedBy: res.ownedBy }),
            );
          }
        }
        const charterFile = writeCharterFile(runId, entry);
        supervisor.spawn({ entry, cwd, mode: COLLAB_PEER_MODE_NAME, ...(charterFile ? { charterFile } : {}) });
        yield await ctx.emit(plugin(ctx, 'collab_agent_spawned', { id: entry.id, role: entry.role }));
      }
      await waitForAgents(hub, supervisor, roster.map((r) => r.id), ctx.signal, cfg.wallClockMs);
      yield* surfaceFailures(ctx, hub, supervisor, roster.map((r) => r.id));
      // Stop every peer process (await its real exit) BEFORE integrate commits/
      // merges its worktree. waitForAgents can return on wall-clock/abort while a
      // peer is still genuinely writing; without this, integrate() would snapshot
      // a worktree a live child is concurrently mutating. stop() is a no-op for
      // already-exited (done/crashed) children, so the happy path is unchanged.
      await Promise.all(roster.map((r) => supervisor!.stop(r.id)));
      for (const r of roster) if (statusOf(hub, r.id) === 'done') doneIds.push(r.id);
    } else {
      // Explicit sequential mode: one agent at a time, in the shared workspace.
      for (const entry of roster) {
        if (ctx.signal.aborted) break;
        hub.state.addAgent(entry);
        const charterFile = writeCharterFile(runId, entry);
        supervisor.spawn({ entry, cwd, mode: COLLAB_PEER_MODE_NAME, ...(charterFile ? { charterFile } : {}) });
        yield await ctx.emit(plugin(ctx, 'collab_agent_spawned', { id: entry.id, role: entry.role }));
        const ok = await waitForAgent(hub, supervisor, entry.id, ctx.signal, cfg.wallClockMs);
        if (!ok) yield* surfaceFailures(ctx, hub, supervisor, [entry.id]);
        // Await the child's real exit before starting the next agent — otherwise
        // two peers briefly edit the shared workspace at once.
        await supervisor.stop(entry.id);
        if (ok && statusOf(hub, entry.id) === 'done') doneIds.push(entry.id);
      }
    }

    if (ctx.signal.aborted) {
      yield await ctx.emit(emitAbort(ctx, 'aborted during build'));
      return;
    }

    // --- Phase 2: integrate (git path only; shared-workspace edits are already in cwd) ---
    let mergeNote = '';
    if (usesGit && doneIds.length > 0) {
      const result = await integrate({
        repoCwd: cwd,
        runId,
        baseSha,
        doneAgentIds: doneIds,
        worktrees,
        board: hub.state.boardItems(),
        mergePolicy: cfg.mergePolicy,
        verifyGate: cfg.verifyGate,
      });
      mergeForArchive = {
        merged: result.merged,
        promoted: result.promoted,
        conflicts: result.conflicts.length,
        ...(result.stagingBranch ? { stagingBranch: result.stagingBranch } : {}),
      };
      yield await ctx.emit(plugin(ctx, 'collab_merge', result));
      for (const c of result.conflicts) {
        yield await ctx.emit(plugin(ctx, 'collab_conflict', c));
      }
      mergeNote = result.conflicts.length
        ? `Merged ${result.merged.length} of ${doneIds.length}; ${result.conflicts.length} left on a branch for review.`
        : result.promoted
          ? `Integrated all ${result.merged.length} agents into your branch.`
          : `Staged ${result.merged.length} agents on ${result.stagingBranch}.`;
    }

    // --- Synthesize ---
    const summaries = hub.state.doneSummaries();
    const summaryBlock = summaries.length
      ? summaries.map((s) => `- **${s.agentId}**: ${s.summary}`).join('\n')
      : '(no agent reported a completion summary)';
    // For the lock-coordinated shared-workspace path there's no merge step — the
    // edits are already live in the workspace. Add a light review nudge.
    const cwdNote =
      execMode === 'cwd-parallel'
        ? 'The team worked together directly in your workspace; please review the result.'
        : '';
    const tail = [mergeNote, cwdNote].filter(Boolean).join('\n\n');
    yield await ctx.emit(
      assistant(
        ctx,
        `Collaboration complete — ${doneIds.length}/${roster.length} agents finished.\n\n${summaryBlock}${tail ? `\n\n${tail}` : ''}`,
      ),
    );
    completed = true;
    yield await ctx.emit(plugin(ctx, 'collab_completed', { done: doneIds, total: roster.length }));
  } catch (err) {
    // A git-layer throw (worktree add on a leftover path, checkout, base resolve,
    // disk full mid-integrate) would otherwise reject the async generator as an
    // unhandled error — the user sees a raw crash and the turn ends abnormally.
    // Degrade gracefully: surface a clean failure event + message, then let the
    // finally tear everything down (and archive the run as 'failed'). `completed`
    // stays false so the archive outcome is correct.
    const message = err instanceof Error ? err.message : String(err);
    yield await ctx.emit(plugin(ctx, 'collab_failed', { message }));
    yield await ctx.emit(
      assistant(ctx, `The collaboration could not finish — ${message}. Any partial work was left on its branch; cleaning up.`),
    );
  } finally {
    if (supervisor) await supervisor.shutdownAll('collaboration complete');
    // Archive the run (durable history) BEFORE tearing the hub down — the record
    // is read from hub.state. Covers every outcome: completed, user-aborted, or
    // failed. Best-effort; archiving must never throw out of the finally.
    if (hub) {
      try {
        const agents = hub.state.rosterView().agents;
        // Counts mirror collab_completed: implementers only (the architect is
        // crew, not a deliverable owner).
        const implementers = agents.filter((a) => a.role !== 'architect');
        writeRunRecord({
          runId,
          task,
          startedAtMs,
          finishedAtMs: Date.now(),
          outcome: completed ? 'completed' : ctx.signal.aborted ? 'aborted' : 'failed',
          parallel: archiveParallel,
          gitRepo: archiveGitRepo,
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            status: a.status,
            subtask: a.subtask,
            ...(a.doneSummary ? { doneSummary: a.doneSummary } : {}),
          })),
          doneCount: implementers.filter((a) => a.status === 'done').length,
          totalCount: implementers.length,
          board: hub.state.boardItems().map((b) => ({
            id: b.id,
            title: b.title,
            status: b.status,
            ...(b.owner ? { owner: b.owner } : {}),
            ...(b.paths ? { paths: b.paths } : {}),
          })),
          contracts: hub.state.contractList().map((c) => ({
            id: c.id,
            title: c.title,
            owner: c.owner,
            status: c.status,
            version: c.version,
          })),
          messageCount: hub.state.allMessages().length,
          ...(mergeForArchive ? { merge: mergeForArchive } : {}),
          ...(briefText ? { brief: briefText } : {}),
        });
      } catch {
        // archiving is an enhancement, not a prerequisite
      }
    }
    if (unsubscribe) unsubscribe();
    unregisterActiveHub(String(ctx.sessionId));
    if (hub) await hub.close();
    releaseCollabLock(String(ctx.sessionId));
    // Cleanup leaked transient state. integrate() removes the done agents'
    // worktrees on its happy path, but worktrees/sockets are orphaned on abort,
    // 0-done, conflict, or any early return. Worktrees are throwaway working
    // dirs (the branch keeps the commits), so removing them is always safe;
    // git branches are intentionally left to integrate()'s conflict-aware logic.
    for (const wt of worktrees.values()) {
      await removeWorktree(cwd, wt).catch(() => undefined);
    }
    // Drop the transient socket dir; the durable run record is archived
    // elsewhere (see the archive step), not here. A recursive delete can partially
    // fail (EBUSY/ENOTEMPTY) if a peer hasn't fully released a unix socket fd;
    // log it under MOXXY_DEBUG instead of swallowing so a genuinely-failing
    // cleanup (permissions) is diagnosable and orphan dirs don't vanish silently.
    try {
      rmSync(collabRunDir(runId), { recursive: true, force: true });
      rmSync(worktreeRoot(runId), { recursive: true, force: true });
    } catch (err) {
      if (process.env.MOXXY_DEBUG) {
        process.stderr.write(`[collab] run-dir cleanup failed for ${runId}: ${(err as Error).message}\n`);
      }
    }
    // Prune any worktree metadata left dangling by a hard-deleted dir (e.g. an
    // integrate staging worktree that never reached its own removeWorktree).
    if (worktrees.size > 0) await git(cwd, ['worktree', 'prune']).catch(() => undefined);
  }
}

// --- helpers ----------------------------------------------------------------

function lastUserPromptText(ctx: ModeContext): string | undefined {
  const events = ctx.log.slice();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as { type: string; text?: string };
    if (e.type === 'user_prompt' && typeof e.text === 'string') return e.text;
  }
  return undefined;
}

function readRoster(path: string, maxAgents: number): RosterEntry[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: RosterEntry[] = [];
    for (const item of raw) {
      const r = item as Partial<RosterEntry>;
      if (typeof r.id !== 'string' || typeof r.subtask !== 'string') continue;
      const id = slug(r.id);
      if (!id || seen.has(id) || id === ARCHITECT_AGENT_ID) continue;
      seen.add(id);
      const ownedPaths = cleanOwnedPaths(r.ownedPaths);
      out.push({
        id,
        // `name` and `subtask` are LLM-authored free text. `subtask` is carried in
        // a spawned peer's env (COLLAB_ENV.Subtask) — an unbounded value bloats the
        // child's environment — so strip NULs and cap both.
        name: cleanText(r.name, 80) || id,
        // Carry the architect's proposed role (pm/designer/developer/qa/writer/…)
        // so the team is cross-functional, not a pool of identical implementers.
        role: cleanRole(r.role),
        subtask: cleanText(r.subtask, 2000),
        ...(ownedPaths.length ? { ownedPaths } : {}),
        ...(typeof r.model === 'string' ? { model: cleanText(r.model, 100) } : {}),
        ...(typeof r.charter === 'string' && r.charter.trim() ? { charter: cleanCharter(r.charter) } : {}),
      });
      if (out.length >= maxAgents) break;
    }
    return out;
  } catch {
    return [];
  }
}

function modelIdCatalog(ctx: ModeContext): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const model of ctx.provider.models) {
    if (typeof model.id === 'string' && model.id.trim()) ids.add(model.id.trim());
  }
  return ids;
}

function resolveRosterModels(
  roster: ReadonlyArray<RosterEntry>,
  fallbackModel: string | undefined,
  modelIds: ReadonlySet<string>,
): RosterEntry[] {
  return roster.map((entry) => {
    const model = resolvePeerModel(entry.model, fallbackModel, modelIds);
    if (model) return { ...entry, model };
    const { model: _model, ...rest } = entry;
    return rest;
  });
}

function resolvePeerModel(
  requested: string | undefined,
  fallback: string | undefined,
  modelIds: ReadonlySet<string>,
): string | undefined {
  return canonicalModelId(requested, modelIds) ?? canonicalModelId(fallback, modelIds);
}

function canonicalModelId(model: string | undefined, modelIds: ReadonlySet<string>): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  if (modelIds.size === 0 || modelIds.has(trimmed)) return trimmed;
  if (!trimmed.startsWith('gpt-')) {
    const prefixed = `gpt-${trimmed}`;
    if (modelIds.has(prefixed)) return prefixed;
  }
  return undefined;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

/** Normalize an architect-proposed role to a short, safe label. `'architect'` is
 *  reserved for the coordinator's planner, so a proposed 'architect' falls back to
 *  'implementer'. Anything unparseable also falls back to 'implementer'. */
/**
 * How the team is executed:
 * - `git-parallel`: each agent in its own git worktree; staged, conflict-aware
 *   merge into the user's branch (full isolation). The default whenever git is
 *   usable — including a folder we just `git init`'d for the user.
 * - `cwd-parallel`: no git available — agents run in parallel in the SHARED
 *   workspace, coordinated only by the advisory file-lock board.
 * - `sequential`: one agent at a time in the shared workspace (the safe, slow
 *   fallback; only when the user explicitly pins concurrency: 'sequential').
 */
type ExecMode = 'git-parallel' | 'cwd-parallel' | 'sequential';

function resolveExecMode(cfg: CollabConfig, gitRepo: boolean): ExecMode {
  if (cfg.concurrency === 'sequential') return 'sequential';
  return gitRepo ? 'git-parallel' : 'cwd-parallel';
}

function cleanRole(raw: unknown): string {
  if (typeof raw !== 'string') return 'implementer';
  const r = raw.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!r || r === ARCHITECT_AGENT_ID) return 'implementer';
  return r;
}

/** Bound a piece of LLM-authored free text: strip NULs (they can't legally appear
 *  in an env var and corrupt downstream parsing), trim, and length-cap. Non-strings
 *  → ''. */
function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\u0000/g, '').trim().slice(0, max);
}

/** Max owned-path claims kept per roster entry, and the per-path length cap. The
 *  architect is told to claim the narrowest set, but the roster is untrusted LLM
 *  output — a runaway list of thousands of claims would bloat the board AND make
 *  the O(claims) ownership scan pathological — so bound both count and length. */
const MAX_OWNED_PATHS = 64;
const MAX_OWNED_PATH_LEN = 512;

/** Normalise a roster entry's `ownedPaths`: keep only non-empty strings, strip
 *  NULs, length-cap each path, dedupe, and cap the count. These feed the file-lock
 *  board + the integrate ownership map, both untrusted-input surfaces. */
function cleanOwnedPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (typeof p !== 'string') continue;
    const cleaned = p.replace(/\u0000/g, '').trim().slice(0, MAX_OWNED_PATH_LEN);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= MAX_OWNED_PATHS) break;
  }
  return out;
}

/** Sanitise an architect-authored charter: strip NULs and cap length (it's
 *  LLM-authored free text that lands in the peer's system prompt, so bound it). */
function cleanCharter(raw: string): string {
  return raw.replace(/\u0000/g, '').trim().slice(0, 2000);
}

/** Write a peer's charter to the run dir (outside cwd/worktrees, so it's never
 *  committed) and return the path, or undefined when there's no charter / write
 *  fails. Best-effort — a missing charter just falls back to the generic prompt. */
function writeCharterFile(runId: string, entry: RosterEntry): string | undefined {
  if (!entry.charter) return undefined;
  const p = charterFilePath(runId, entry.id);
  try {
    writeFileSync(p, `${entry.charter}\n`);
    return p;
  } catch {
    return undefined;
  }
}

type HubLike = { state: { rosterView(): { agents: ReadonlyArray<{ id: string; status: string }> } } };
type ExitProbe = Pick<Supervisor, 'hasExited'> | null;

function statusOf(hub: HubLike, id: string): string | undefined {
  return hub.state.rosterView().agents.find((a) => a.id === id)?.status;
}

/**
 * Has an agent reached a state we should stop waiting on? Returns 'done' (it
 * finished cleanly), 'failed' (terminal but not done — crashed/killed/failed, OR
 * its process exited with no terminal status, OR it never registered within the
 * boot window), or undefined (still in flight). `connected` records which ids
 * have registered so the boot deadline only applies before registration.
 */
function agentSettled(
  hub: HubLike,
  supervisor: ExitProbe,
  id: string,
  connected: Set<string>,
  bootDeadlineAt: number,
): 'done' | 'failed' | undefined {
  const status = statusOf(hub, id);
  if (status && status !== 'pending') connected.add(id); // any reported status ⇒ registered
  if (status === 'done') return 'done';
  if (status === 'failed' || status === 'crashed' || status === 'killed') return 'failed';
  // Process gone but no terminal status: died before reporting, or the spawn
  // itself failed (the supervisor's 'error'/'exit' handlers set hasExited).
  if (supervisor?.hasExited(id)) return 'failed';
  // Never registered within the boot window ⇒ it failed to come up.
  if (!connected.has(id) && Date.now() > bootDeadlineAt) return 'failed';
  return undefined;
}

/** Poll until an agent settles (done/failed) or abort/wall-clock. Returns true iff done. */
async function waitForAgent(
  hub: HubLike,
  supervisor: ExitProbe,
  id: string,
  signal: AbortSignal,
  wallClockMs: number,
): Promise<boolean> {
  const wallDeadline = Date.now() + wallClockMs;
  const bootDeadlineAt = Date.now() + BOOT_DEADLINE_MS;
  const connected = new Set<string>();
  for (;;) {
    const settled = agentSettled(hub, supervisor, id, connected, bootDeadlineAt);
    if (settled === 'done') return true;
    if (settled === 'failed') return false;
    if (signal.aborted || Date.now() > wallDeadline) return false;
    await sleep(POLL_MS, signal);
  }
}

async function waitForAgents(
  hub: HubLike,
  supervisor: ExitProbe,
  ids: ReadonlyArray<string>,
  signal: AbortSignal,
  wallClockMs: number,
): Promise<void> {
  const wallDeadline = Date.now() + wallClockMs;
  const bootDeadlineAt = Date.now() + BOOT_DEADLINE_MS;
  const connected = new Set<string>();
  for (;;) {
    if (ids.every((id) => agentSettled(hub, supervisor, id, connected, bootDeadlineAt) !== undefined)) return;
    if (signal.aborted || Date.now() > wallDeadline) return;
    await sleep(POLL_MS, signal);
  }
}

/**
 * After a wait, any agent that isn't 'done' didn't succeed. Make its hub status
 * terminal (so it frees its file locks + the UI updates) and surface the tail of
 * its stderr as a `collab_agent_failed` event, so a boot/connect/run failure is
 * a visible diagnostic instead of a silent gap.
 */
async function* surfaceFailures(
  ctx: ModeContext,
  hub: CollaborationHub,
  supervisor: Supervisor,
  ids: ReadonlyArray<string>,
): AsyncGenerator<MoxxyEvent, void, unknown> {
  for (const id of ids) {
    const status = statusOf(hub, id);
    if (status === 'done') continue;
    if (status !== 'failed' && status !== 'crashed' && status !== 'killed') {
      hub.state.setStatus(id, 'crashed', 'did not reach a terminal status');
    }
    yield await ctx.emit(
      plugin(ctx, 'collab_agent_failed', {
        id,
        status: statusOf(hub, id),
        stderr: supervisor.stderrOf(id).slice(-6),
      }),
    );
  }
}

/** Abortable delay. Exported for tests (it must not leak abort listeners over
 *  the run's thousands of poll iterations). Internal otherwise. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      // The poll loop calls this thousands of times over a run; remove the
      // abort listener on the normal-timeout path too, or they accumulate on
      // the long-lived coordinator signal (MaxListenersExceededWarning + leak).
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    t.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function toCollabEvent(ctx: ModeContext, e: CollabEvent): MoxxyEvent {
  const map: Record<CollabEvent['kind'], string> = {
    agent_status: 'collab_agent_status',
    message: 'collab_message',
    board: 'collab_board_update',
    contract: 'collab_contract',
    agent_done: 'collab_agent_done',
    control: 'collab_control',
  };
  let subtype = map[e.kind];
  if (e.kind === 'contract') {
    subtype =
      e.action === 'published'
        ? 'collab_contract_published'
        : e.action === 'change_proposed'
          ? 'collab_contract_change_proposed'
          : 'collab_contract_changed';
  }
  return plugin(ctx, subtype, e);
}

function plugin(ctx: ModeContext, subtype: string, payload: unknown): MoxxyEvent {
  return {
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: COLLAB_PLUGIN_ID,
    subtype,
    payload,
  } as MoxxyEvent;
}

function assistant(ctx: ModeContext, content: string): MoxxyEvent {
  return {
    type: 'assistant_message',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    content,
    stopReason: 'end_turn',
  } as MoxxyEvent;
}

function emitAbort(ctx: ModeContext, reason: string): MoxxyEvent {
  return {
    type: 'abort',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    reason,
  } as MoxxyEvent;
}
