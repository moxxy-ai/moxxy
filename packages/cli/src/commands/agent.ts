import { startRunnerServer, type RunnerServer } from '@moxxy/runner';
import type { Session } from '@moxxy/core';
import type { RunTurnOptions } from '@moxxy/sdk';
import { getProcessHubClient } from '@moxxy/plugin-collab';
import type { ParsedArgv } from '../argv.js';
import { bootSessionWithConfig, helpRequested } from '../argv-helpers.js';

/**
 * `moxxy agent` — INTERNAL. A headless collaboration peer runner, spawned by
 * the `collaborative` coordinator (never run directly). It boots a Session in
 * the current directory (a git worktree, or the shared workspace in the no-git
 * fallback), joins the hub via env, exposes its own runner socket (so the
 * desktop can attach for the full transcript), and drives its sub-task turn
 * autonomously until the coordinator shuts it down.
 *
 * Env (set by the coordinator's PeerSupervisor): MOXXY_COLLAB_HUB,
 * MOXXY_COLLAB_AGENT_ID, MOXXY_COLLAB_SUBTASK, MOXXY_RUNNER_SOCKET,
 * MOXXY_SESSION_ID, MOXXY_MODE, MOXXY_MODEL.
 */
export async function runAgentCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(
      'moxxy agent — internal: a collaboration peer runner spawned by collaborative mode.\n',
    );
    return 0;
  }

  const sessionId = process.env.MOXXY_SESSION_ID?.trim();
  const mode = process.env.MOXXY_MODE?.trim() || 'collab-peer';
  const subtask = process.env.MOXXY_COLLAB_SUBTASK ?? '';
  const parentTask = process.env.MOXXY_COLLAB_PARENT_TASK?.trim() ?? '';
  const role = process.env.MOXXY_COLLAB_ROLE?.trim() ?? '';
  const model = process.env.MOXXY_MODEL?.trim();

  // Seed the turn with the WHOLE picture, not just this agent's narrow subtask:
  // the overall team goal (previously plumbed into the env but never read) plus a
  // pointer to the shared brief + contracts the coordinator/architect wrote. An
  // implementer that knows the real goal builds the right thing instead of
  // guessing from a one-line task. The architect's subtask already IS the goal,
  // so it just gets the brief pointer.
  const seededTurn = buildSeedTurn({ role, parentTask, subtask });

  const setup = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    // A peer must NOT start the port-binding daemons (webhooks/scheduler) — many
    // peers run at once. skipInitHooks gives the populated registries without them.
    skipInitHooks: true,
    ...(sessionId ? { sessionId } : {}),
    ...(model ? { model } : {}),
  });
  const { session } = setup;

  // Headless: auto-approve so the agent applies changes unattended. The collab
  // loop also wraps this, but the base resolver must not deny-by-default in a
  // non-interactive process.
  session.setPermissionResolver({
    name: 'collab-peer-allow',
    check: async () => ({ mode: 'allow', reason: 'collaboration peer (headless, auto-approved)' }),
  });

  try {
    session.modes.setActive(mode);
  } catch {
    // mode plugin missing → fall back to whatever is active
  }

  const runnerServer = await startRunnerServer(session);

  // Drive the sub-task turn (autonomous loop). Errors surface on the event log.
  const turnDone = (async () => {
    try {
      for await (const _ of session.runTurn(seededTurn, agentRunTurnOptions(model))) void _;
    } catch {
      // the loop already emitted an error event
    }
    // Liveness: the autonomous loop ends by calling collab_done (→ hub status
    // 'done') OR by giving up (fatal error / iteration-cap / idle / stuck) — and
    // those paths leave NO hub status while this process keeps idling below so
    // the desktop can attach. Without a signal the coordinator would poll the
    // full wall-clock (30 min) before timing the agent out. Report a terminal
    // 'failed' status when the turn ended without self-completing so the
    // coordinator stops waiting immediately.
    try {
      const hub = await getProcessHubClient();
      if (hub) {
        const mine = (await hub.roster()).agents.find((a) => a.id === hub.agentId);
        if (mine && mine.status !== 'done') {
          await hub.setStatus('failed', 'turn ended without calling collab_done');
        }
      }
    } catch {
      // best-effort — never let liveness reporting crash the peer
    }
  })();

  await runUntilSignal(runnerServer, session, turnDone);
  return 0;
}

export function agentRunTurnOptions(model: string | undefined): RunTurnOptions {
  const trimmed = model?.trim();
  return trimmed ? { model: trimmed } : {};
}

/**
 * Compose the first-turn prompt for a collaboration agent. The architect's
 * subtask already is the full goal, so it only needs the brief pointer; an
 * implementer is framed with the overall goal first, then its slice, then where
 * to find the shared context. The pointer is cheap (one line) and the agent only
 * pays for the brief's tokens if it actually reads the file.
 */
export function buildSeedTurn(args: { role: string; parentTask: string; subtask: string }): string {
  const { role, parentTask, subtask } = args;
  const pointer =
    'Shared team context is in `.moxxy-collab/BRIEF.md` (a concise summary of the ' +
    "user's goal + key requirements) and `.moxxy-collab/CONTRACTS.md` (the agreed " +
    'interfaces). Read them before you start so your work fits the real goal. If you ' +
    'need a detail the brief omits, read or grep `.moxxy-collab/CONVERSATION.md` (the ' +
    'full transcript) — do not load it wholesale. You may share ONE live workspace ' +
    'with the other agents (no isolation) — collab_claim before every edit, edit only ' +
    'what you own, and release when done.';
  if (role === 'architect' || !parentTask || parentTask === subtask) {
    return subtask ? `${subtask}\n\n${pointer}` : pointer;
  }
  const roleLine = role && role !== 'implementer' ? `Your role on the team: ${role}.\n` : '';
  return `${roleLine}Overall team goal: ${parentTask}\n\nYour sub-task: ${subtask}\n\n${pointer}`;
}

async function runUntilSignal(
  runnerServer: RunnerServer,
  session: Session,
  turnDone: Promise<void>,
): Promise<void> {
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref?.();
    await runnerServer.close().catch(() => undefined);
    await session.close(signal).catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  setInterval(() => {}, 60_000).unref?.();

  // Run the turn, then idle (RunnerServer stays up so the desktop can attach to
  // inspect the transcript) until the coordinator kills us.
  await turnDone.catch(() => undefined);
  await new Promise<void>(() => {
    /* until SIGTERM */
  });
}
