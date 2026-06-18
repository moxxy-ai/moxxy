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
  ROSTER_FILENAME,
  collabBranch,
  collabRunDir,
  collabRunId,
  hubSocketPath,
  worktreePath,
  worktreeRoot,
} from './constants.js';
import { resolveCollabConfig, type CollabConfig } from './config.js';
import { buildBrief } from './brief.js';
import {
  addWorktree,
  commitAll,
  detectGit,
  git,
  headSha,
  peerReaderFor,
  removeWorktree,
  resolveBase,
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

  const cfg = deps.config ?? resolveCollabConfig();
  const cwd = deps.cwd ?? process.cwd();
  const task = lastUserPromptText(ctx) ?? '';
  if (!task.trim()) {
    yield await ctx.emit(assistant(ctx, 'Collaborative mode needs a task to work on.'));
    return;
  }

  // Global single-flight: only one collaboration runs at a time (each spawns a
  // fleet of agent processes). Refuse rather than thrash resources.
  const lock = tryAcquireCollabLock({ sessionId: String(ctx.sessionId), task, startedAtMs: Date.now() });
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
  const worktrees = new Map<string, string>();
  let hub: CollaborationHub | null = null;
  let supervisor: Supervisor | null = null;
  let unsubscribe: (() => void) | null = null;
  try {
    mkdirSync(collabRunDir(runId), { recursive: true });

  const { installed: gitInstalled, repo: gitRepo } = await detectGit(cwd);
  const parallel = cfg.concurrency === 'parallel' && gitRepo;
  if (!parallel) {
    yield await ctx.emit(
      plugin(ctx, 'collab_fallback_sequential', {
        reason: !gitInstalled
          ? 'git is not installed — running agents sequentially in your workspace'
          : !gitRepo
            ? 'this folder is not a git repository — running agents sequentially in your workspace'
            : 'sequential mode selected',
      }),
    );
  }

  // Base commit (git path only). A dirty tree is snapshotted so work is never lost.
  let baseSha = '';
  if (parallel) {
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
    peerReader: peerReaderFor(worktrees, baseSha),
  });
  registerActiveHub(String(ctx.sessionId), hub);
  unsubscribe = hub.subscribe((e) => {
    void ctx.emit(toCollabEvent(ctx, e));
  });

  const supervisorOpts: PeerSupervisorOptions = {
    runId,
    hubSocket: hub.socketPath,
    coordinatorSessionId: String(ctx.sessionId),
    parentTask: task,
    ...(cfg.defaultModel ? { defaultModel: cfg.defaultModel } : {}),
    signal: ctx.signal,
  };
  supervisor = (deps.createSupervisor ?? ((o) => new PeerSupervisor(o)))(supervisorOpts, hub);

    yield await ctx.emit(plugin(ctx, 'collab_started', { task, parallel, gitInstalled, gitRepo }));

    // Distil the user's conversation into a shared BRIEF the whole team inherits
    // (the overall goal + intent — not just each agent's narrow subtask). Written
    // into the scaffold up front so the architect reads it, and committed with the
    // scaffold (parallel) so every worktree gets it. Best-effort: a brief-write
    // failure must never sink the run.
    try {
      mkdirSync(join(cwd, COLLAB_SCAFFOLD_DIR), { recursive: true });
      writeFileSync(join(cwd, COLLAB_SCAFFOLD_DIR, BRIEF_FILENAME), buildBrief(task, ctx.log.slice()));
      yield await ctx.emit(plugin(ctx, 'collab_brief_written', { path: join(COLLAB_SCAFFOLD_DIR, BRIEF_FILENAME) }));
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
    yield await ctx.emit(plugin(ctx, 'collab_roster_proposed', { roster }));

    if (cfg.requireRosterApproval && ctx.approval) {
      const decision = await ctx.approval.confirm({
        title: `Team of ${roster.length} agent${roster.length === 1 ? '' : 's'} — review before launch`,
        body: roster.map((r, i) => `${i + 1}. [${r.id}] ${r.name} — ${r.role}\n    ${r.subtask}`).join('\n\n'),
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

    // Commit the scaffold (CONTRACTS.md, roster.json, any stubs) so worktrees inherit it.
    if (parallel) {
      await commitAll(cwd, 'moxxy-collab: scaffold contracts');
      baseSha = await headSha(cwd);
      mkdirSync(worktreeRoot(runId), { recursive: true });
    }

    // --- Phase 1: implementers ---
    const doneIds: string[] = [];
    if (parallel) {
      for (const entry of roster) {
        hub.state.addAgent(entry);
        const wt = worktreePath(runId, entry.id);
        await addWorktree({ repoCwd: cwd, path: wt, branch: collabBranch(runId, entry.id), baseSha });
        worktrees.set(entry.id, wt);
        supervisor.spawn({ entry, cwd: wt, mode: COLLAB_PEER_MODE_NAME });
        yield await ctx.emit(plugin(ctx, 'collab_agent_spawned', { id: entry.id, role: entry.role }));
      }
      await waitForAgents(hub, supervisor, roster.map((r) => r.id), ctx.signal, cfg.wallClockMs);
      yield* surfaceFailures(ctx, hub, supervisor, roster.map((r) => r.id));
      for (const r of roster) if (statusOf(hub, r.id) === 'done') doneIds.push(r.id);
    } else {
      // Sequential fallback (no git): one agent at a time, in the shared workspace.
      for (const entry of roster) {
        if (ctx.signal.aborted) break;
        hub.state.addAgent(entry);
        supervisor.spawn({ entry, cwd, mode: COLLAB_PEER_MODE_NAME });
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

    // --- Phase 2: integrate (git path only; sequential edits are already in cwd) ---
    let mergeNote = '';
    if (parallel && doneIds.length > 0) {
      const result = await integrate({
        repoCwd: cwd,
        runId,
        baseSha,
        doneAgentIds: doneIds,
        worktrees,
        board: hub.state.boardItems(),
        mergePolicy: cfg.mergePolicy,
      });
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
    yield await ctx.emit(
      assistant(
        ctx,
        `Collaboration complete — ${doneIds.length}/${roster.length} agents finished.\n\n${summaryBlock}${mergeNote ? `\n\n${mergeNote}` : ''}`,
      ),
    );
    yield await ctx.emit(plugin(ctx, 'collab_completed', { done: doneIds, total: roster.length }));
  } finally {
    if (supervisor) await supervisor.shutdownAll('collaboration complete');
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
    // elsewhere (see the archive step), not here.
    try {
      rmSync(collabRunDir(runId), { recursive: true, force: true });
      rmSync(worktreeRoot(runId), { recursive: true, force: true });
    } catch {
      // best-effort
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
      out.push({
        id,
        name: typeof r.name === 'string' ? r.name : id,
        role: 'implementer',
        subtask: r.subtask,
        ...(Array.isArray(r.ownedPaths) ? { ownedPaths: r.ownedPaths.filter((p) => typeof p === 'string') } : {}),
        ...(typeof r.model === 'string' ? { model: r.model } : {}),
      });
      if (out.length >= maxAgents) break;
    }
    return out;
  } catch {
    return [];
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
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
