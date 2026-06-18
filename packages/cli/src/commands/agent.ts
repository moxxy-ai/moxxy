import { startRunnerServer, type RunnerServer } from '@moxxy/runner';
import type { Session } from '@moxxy/core';
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
  const model = process.env.MOXXY_MODEL?.trim();

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
      for await (const _ of session.runTurn(subtask)) void _;
    } catch {
      // the loop already emitted an error event
    }
  })();

  await runUntilSignal(runnerServer, session, turnDone);
  return 0;
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
