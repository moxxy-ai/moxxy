import { startRunnerServer, type RunnerServer } from '@moxxy/runner';
import type { Session } from '@moxxy/core';
import { COLLAB_MODE_NAME, collabCoordinatorSocketPath } from '@moxxy/mode-collaborative';
import type { ParsedArgv } from '../argv.js';
import { bootSessionWithConfig, helpRequested } from '../argv-helpers.js';

/**
 * `moxxy collab` — the dedicated collaboration COORDINATOR runner. Spawned by a
 * UI (the desktop Collaborate panel or the TUI `/collab` command) — not usually
 * run by hand.
 *
 * The coordinator no longer runs inside a user's chat session (which polluted
 * that chat's thread with the whole team's activity and flipped its mode). It
 * runs here, headless, in its OWN Session on its OWN runner socket:
 *   - boots a Session (own id, no port-binding daemons),
 *   - activates the `collaborative` mode,
 *   - starts a RunnerServer on the stable coordinator socket so a UI can attach,
 *   - and then IDLES.
 *
 * It deliberately does NOT drive the goal turn itself. The attaching UI submits
 * the goal via `runTurn`, which makes the turn client-scoped — so the roster
 * approval checkpoint (and every event) is routed back to that UI. A turn we
 * started locally would be UNSCOPED, and the runner would silently take the
 * default approval option instead of asking the human (see RunnerServer's
 * resolver routing). Hosting-only keeps the human-in-the-loop gate intact.
 *
 * Env: MOXXY_SESSION_ID (fresh per run, set by the spawner), MOXXY_RUNNER_SOCKET
 * (defaults to the stable coordinator socket), MOXXY_MODEL.
 */
export async function runCollabCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(
      'moxxy collab — the dedicated collaboration coordinator runner (spawned by the desktop/TUI collaborate UI).\n',
    );
    return 0;
  }

  // Bind the coordinator's runner socket BEFORE booting so `startRunnerServer`
  // picks it up and the coordinator loop records it in the single-flight lock
  // (that's how a UI discovers where to attach). A spawner may override it.
  if (!process.env.MOXXY_RUNNER_SOCKET?.trim()) {
    process.env.MOXXY_RUNNER_SOCKET = collabCoordinatorSocketPath();
  }

  const sessionId = process.env.MOXXY_SESSION_ID?.trim();
  const model = process.env.MOXXY_MODEL?.trim();

  const setup = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    // A coordinator, like a peer, must NOT start the port-binding daemons
    // (webhooks/scheduler) — it is a background runner, not a full `serve`.
    // skipInitHooks still populates the plugin registries (modes, tools, hub).
    skipInitHooks: true,
    ...(sessionId ? { sessionId } : {}),
    ...(model ? { model } : {}),
  });
  const { session } = setup;

  // Activate the coordinator mode so the UI only has to submit the goal. We do
  // NOT install a permission/approval resolver here: the RunnerServer's routing
  // resolver forwards the client-scoped turn's approvals to the attached UI.
  try {
    session.modes.setActive(COLLAB_MODE_NAME);
  } catch {
    // mode plugin missing → the attaching UI will surface the failure
  }

  const runnerServer = await startRunnerServer(session);
  await runUntilSignal(runnerServer, session);
  return 0;
}

/**
 * Idle until a shutdown signal. The RunnerServer stays up so the UI can attach,
 * drive the goal turn, and monitor the run; the coordinator loop's own `finally`
 * releases the collab lock and tears the team down when the turn ends or aborts.
 */
async function runUntilSignal(runnerServer: RunnerServer, session: Session): Promise<void> {
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

  await new Promise<void>(() => {
    /* until SIGTERM */
  });
}
