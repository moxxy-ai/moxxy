import {
  createInteractivePermissionResolver,
  InteractiveSession,
  type InteractiveBootStep,
} from '@moxxy/plugin-cli';
import { loadActiveModel } from '@moxxy/config';
import { render } from 'ink';
import React from 'react';
import type {
  ChannelHandle,
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
} from '@moxxy/sdk';
import { coAttachWebSurface } from './web-surface.js';
import { loadConfig } from '@moxxy/config';
import {
  connectRemoteSession,
  isRunnerUp,
  startRunnerServer,
  runnerSocketPath,
  type RemoteSession,
  type RunnerServer,
} from '@moxxy/runner';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { collabCoordinatorSocketPath, readActiveCollab } from '@moxxy/mode-collaborative';
import type { ClientSession } from '@moxxy/sdk';
import { probeSession, setupSessionWithConfig, type BootStep } from '../setup.js';

/** Best-effort recovery for "I had an older `moxxy serve` running
 *  at v1 and the new client is v2" scenarios. Kill whatever PID is
 *  holding the socket, then unlink the socket file so the next
 *  spawn binds cleanly. macOS / Linux only — lsof on Windows is
 *  out of scope here. */
/**
 * Read the PID holding `socketPath` via `lsof -t`, BOUNDED by `timeoutMs`.
 * `lsof` can hang (a stalled NFS mount, a host with a huge FD table) — and the
 * caller runs precisely when the user is already stranded by a stale runner, so
 * an unbounded read here would let the recovery itself wedge `moxxy tui`
 * forever. On timeout (or any error / non-numeric output) we kill the child and
 * resolve `null`; the caller then just unlinks the stale socket without killing
 * anything. Exported for failure-path testing.
 */
export async function readSocketHolderPid(
  socketPath: string,
  timeoutMs = 3000,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    if (process.platform === 'win32') return resolve(null);
    let out = '';
    let settled = false;
    let child: ReturnType<typeof spawn> | null = null;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish(null);
    }, timeoutMs);
    timer.unref?.();
    try {
      child = spawn('lsof', ['-t', socketPath], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      child.stdout?.on('data', (b) => {
        out += b.toString();
      });
      child.on('error', () => finish(null));
      child.on('close', () => {
        const parsed = parseInt(out.trim().split('\n')[0] ?? '', 10);
        finish(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
      });
    } catch {
      finish(null);
    }
  });
}

async function killStaleRunnerAt(socketPath: string): Promise<void> {
  if (!existsSync(socketPath)) return;
  const pid = await readSocketHolderPid(socketPath);
  // Only kill a PID we can positively identify as a moxxy runner. A stale
  // socket file plus a recycled PID (the OS reassigned it to an unrelated
  // process) or a racy lsof read would otherwise make us SIGKILL an arbitrary
  // user process. If we can't confirm it's ours, leave it alone and just
  // unlink the stale socket below.
  if (pid && pid !== process.pid && (await looksLikeMoxxyRunner(pid))) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already dead */
    }
  }
  // Drain any lingering socket file so the self-host bind doesn't
  // EADDRINUSE.
  try {
    unlinkSync(socketPath);
  } catch {
    /* may already be gone */
  }
}

/**
 * Best-effort: does this PID's command line look like a moxxy runner? Used to
 * gate the SIGKILL in {@link killStaleRunnerAt} so we never kill an unrelated
 * process that happens to have been assigned a recycled PID. Conservative:
 * returns false (don't kill) on any uncertainty.
 */
export async function looksLikeMoxxyRunner(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === 'linux') {
      // /proc/<pid>/cmdline is NUL-separated argv.
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      return /moxxy/i.test(cmdline) || /\bserve\b/.test(cmdline);
    }
    // macOS (and other POSIX): ask ps for the full command of just this PID.
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2000,
    });
    if (r.status !== 0 || !r.stdout) return false;
    const cmd = r.stdout.trim();
    return /moxxy/i.test(cmd) || /\bserve\b/.test(cmd);
  } catch {
    return false;
  }
}
import { argvToSetupOptions, hasBoolFlag, stringFlag } from '../argv-helpers.js';
import { chooseClientMode } from './client-mode.js';
import type { ParsedArgv } from '../argv.js';
import { cliVersion } from '../version.js';
import { readCachedCheck, refreshCheck } from '../update/check.js';
import { detectInstall } from '../update/detect-install.js';
import { runInitCommand } from './init.js';
import type { Session } from '@moxxy/core';

/**
 * Cheap, non-blocking "is there a newer @moxxy/cli?" for the TUI banner.
 * Reads only the cached answer (instant, no network on the startup path) and
 * kicks a background refresh so the cache is warm next launch. Returns nothing
 * for a source checkout (don't nag devs) or when there's no newer version.
 */
function resolveUpdateNotice(version: string | undefined): { latest: string } | undefined {
  if (!version) return undefined;
  if (detectInstall().manager === 'workspace') return undefined;
  void refreshCheck(version).catch(() => undefined); // warm the cache for next time
  const cached = readCachedCheck(version);
  return cached?.updateAvailable ? { latest: cached.latest } : undefined;
}

/**
 * `moxxy tui`. Three modes:
 *
 *  - **attach** (default when a runner is up): connect to the running
 *    `moxxy serve` as a thin client. No session boot - instant, and the
 *    conversation streams live + replays on attach.
 *  - **self-host** (default when no runner is up): boot a local Session AND
 *    open the runner socket (Option A) so other clients can attach while this
 *    TUI is open. Tears the socket down on exit.
 *  - **standalone** (`--standalone`): boot a local Session and do NOT open the
 *    socket - fully isolated, ≈ the pre-split behavior.
 */
export interface RunTuiOpts {
  /** Resume a persisted session by id. Seeds the EventLog from disk. */
  readonly resumeSessionId?: string;
  /** Cwd restored from session metadata when resuming outside the original directory. */
  readonly cwd?: string;
}

export async function runTuiWithBootstrap(
  argv: ParsedArgv,
  tuiOpts: RunTuiOpts = {},
): Promise<number> {
  const standalone = hasBoolFlag(argv, 'standalone');
  const mode = chooseClientMode({ standalone, runnerUp: standalone ? false : await isRunnerUp() });
  if (mode === 'attach') return await runAttachedTui(argv, tuiOpts);
  return await runSelfHostedTui(argv, tuiOpts, mode === 'standalone');
}

/** Thin-client mode: drive a `RemoteSession` against the running runner. */
async function runAttachedTui(argv: ParsedArgv, tuiOpts: RunTuiOpts): Promise<number> {
  let promptHandler:
    | ((call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>)
    | null = null;
  const resolver = createInteractivePermissionResolver({
    name: 'tui',
    prompt: async (call, ctx) => {
      if (!promptHandler) return { mode: 'deny', reason: 'TUI not ready' };
      return promptHandler(call, ctx);
    },
  });

  let remote: RemoteSession;
  try {
    remote = await connectRemoteSession({ role: 'tui' });
  } catch (err) {
    const msg = errMsg(err);
    // A stale `moxxy serve` from a previous (older) install can hold
    // the socket open at a lower protocol version. Detect that and
    // recover by killing the stale daemon, then fall through to
    // self-host mode so the user isn't stranded.
    if (/protocol mismatch/i.test(msg)) {
      process.stderr.write(
        `stale runner detected at ${runnerSocketPath()} (${msg}); killing it and self-hosting.\n`,
      );
      await killStaleRunnerAt(runnerSocketPath()).catch(() => undefined);
      return await runSelfHostedTui(argv, tuiOpts, false);
    }
    process.stderr.write(`failed to attach to the runner at ${runnerSocketPath()}: ${msg}\n`);
    return 1;
  }
  // Register as the resolver for the turns this client starts.
  remote.setPermissionResolver(resolver);

  const effectiveModel = stringFlag(argv, 'model') ?? (await loadActiveModel());
  const version = cliVersion();
  const updateNotice = resolveUpdateNotice(version);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const force = setTimeout(() => process.exit(0), 4000);
    force.unref?.();
    await remote.close().catch(() => undefined);
  };

  const instance = render(
    React.createElement(InteractiveSession, {
      session: remote,
      registerInteractiveResolver: (handler) => {
        promptHandler = handler;
      },
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(version ? { version } : {}),
      ...(updateNotice ? { updateAvailable: updateNotice } : {}),
      // Land directly in the (replayed) conversation rather than the splash.
      resumed: true,
    }),
  );

  // Funnel every exit trigger (signal / runner loss) through unmount() so the
  // `finally` below is the single place that runs shutdown + lets the process
  // exit — no racing `process.exit(0)` against the natural waitUntilExit path.
  // An unref'd force-timer is a backstop if unmount somehow doesn't settle.
  const onSignal = (): void => {
    if (shuttingDown) return;
    const force = setTimeout(() => process.exit(0), 4000);
    force.unref?.();
    instance.unmount();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  // If the runner goes away, the session is gone - tear down the UI and tell
  // the user to reattach rather than leaving a frozen screen.
  remote.onClose(() => {
    if (shuttingDown) return;
    process.stderr.write('\nrunner disconnected - exiting. Re-run `moxxy tui` to reattach.\n');
    instance.unmount();
  });

  try {
    await instance.waitUntilExit();
  } finally {
    await shutdown();
  }
  return 0;
}

/**
 * Self-host / standalone mode. Boots a local Session (bootstrap-inverted so
 * the splash renders from the first frame) and - unless `--standalone` -
 * opens the runner socket so other clients can attach (Option A).
 */
async function runSelfHostedTui(
  argv: ParsedArgv,
  tuiOpts: RunTuiOpts,
  standalone: boolean,
): Promise<number> {
  if (process.stdin.isTTY) {
    const { sources } = await loadConfig({
      cwd: process.cwd(),
      ...(stringFlag(argv, 'config') ? { explicitPath: stringFlag(argv, 'config')! } : {}),
    });
    let needsInit = sources.length === 0;
    if (!needsInit) {
      try {
        // Throwaway probe: "does a provider activate with the current
        // config?". probeSession skips init hooks (no daemons) and closes
        // the session before returning — the REAL session boots below with
        // full init hooks.
        const hasProvider = await probeSession(
          {
            ...argvToSetupOptions(argv),
            tolerateNoProvider: true,
            skipKeyPrompt: true,
          },
          ({ session }) => Boolean(session.providers.getActiveName()),
        );
        if (!hasProvider) needsInit = true;
      } catch {
        needsInit = true;
      }
    }
    if (needsInit) {
      const code = await runInitCommand(argv);
      if (code !== 0) return code;
    }
  }

  let promptHandler:
    | ((call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>)
    | null = null;
  const resolver = createInteractivePermissionResolver({
    name: 'tui',
    prompt: async (call, ctx) => {
      if (!promptHandler) return { mode: 'deny', reason: 'TUI not ready' };
      return promptHandler(call, ctx);
    },
  });

  const effectiveModel = stringFlag(argv, 'model') ?? (await loadActiveModel());
  const version = cliVersion();
  const updateNotice = resolveUpdateNotice(version);

  // Capture the resolved session + optional runner so shutdown can fire
  // `onShutdown` hooks and release the socket. These are re-pointed in place
  // when the user switches sessions via `/sessions` (see `switchSession`).
  // ClientSession (not the concrete core Session) because a `/collab` switch
  // re-points the TUI onto the dedicated coordinator via a RemoteSession, which
  // is a ClientSession, not a locally-booted core Session.
  let bootedSession: ClientSession | null = null;
  let runnerServer: RunnerServer | null = null;
  let webHandle: ChannelHandle | null = null;
  // The dedicated `moxxy collab` coordinator process, when a `/collab` spawned
  // one. Kept so shutdown can reap it (it dies with the TUI, like the old in-chat
  // collab did); switching AWAY only drops the client, leaving the run alive.
  let collabChild: ChildProcess | null = null;
  // The live vault from the most recent boot, exposed to the TUI (via getVault)
  // so the `/channels` panel can store channel secrets in the SAME already-open
  // vault — re-opening a second VaultStore could re-trigger a passphrase prompt
  // mid-render and corrupt the Ink screen. Structural type to keep it loose.
  let bootedVault: { has(n: string): Promise<boolean>; set(n: string, v: string): Promise<void> } | null = null;
  // Channel defs registered at boot, exposed to the `/channels` panel (the TUI's
  // ClientSession doesn't carry the channel registry).
  let bootedChannels: ReturnType<Session['channels']['list']> = [];
  let shuttingDown = false;
  // Serializes session switches against each other and against shutdown so a
  // switch in flight can't race a SIGINT teardown (or a second switch).
  let switching: Promise<void> = Promise.resolve();

  /**
   * Tear down the surfaces wrapping the CURRENT session (web surface + runner
   * socket) and close it, firing its `onShutdown` hooks. Used both by the
   * top-level shutdown and by a session switch (which then boots a replacement).
   */
  const teardownCurrent = async (reason: NodeJS.Signals | 'switch' | 'normal'): Promise<void> => {
    await webHandle?.stop('shutdown').catch(() => undefined);
    webHandle = null;
    await runnerServer?.close().catch(() => undefined);
    runnerServer = null;
    const s = bootedSession;
    bootedSession = null;
    if (!s) return;
    try {
      await s.close(reason === 'normal' ? undefined : reason);
    } catch {
      // Best-effort; never block on cleanup errors.
    }
  };

  /**
   * Boot a session (optionally resuming a persisted id) and wire its surfaces:
   * open the runner socket (unless `--standalone`) so other clients can attach,
   * and co-attach the web surface for `present_view`. Updates the captured refs.
   * `onProgress` is only passed on the FIRST boot (the splash is on-screen);
   * switches boot silently.
   */
  const bootSession = async (
    opts: { resumeSessionId?: string; freshSessionId?: string },
    progress?: (step: InteractiveBootStep) => void,
  ): Promise<Session> => {
    const result = await setupSessionWithConfig({
      ...argvToSetupOptions(argv, tuiOpts.cwd ? { cwd: tuiOpts.cwd } : {}),
      resolver,
      ...(progress ? { onProgress: (step: BootStep) => progress(toInteractiveStep(step)) } : {}),
      ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
      ...(opts.freshSessionId ? { sessionId: opts.freshSessionId } : {}),
    });
    bootedSession = result.session;
    bootedVault = result.vault;
    bootedChannels = result.session.channels.list();
    // Option A: open the socket so other clients can attach while this TUI is
    // open. A lost race (someone else bound first) just means we run without
    // sharing — not an error.
    if (!standalone) {
      try {
        runnerServer = await startRunnerServer(result.session);
      } catch {
        runnerServer = null;
      }
    }
    // Co-attach the web surface to THIS session so `present_view` returns a real
    // URL (local by default — no public tunnel for the TUI). `write` is
    // suppressed: the URL flows back through present_view → the agent's reply,
    // and stdout would corrupt the Ink render.
    webHandle = await coAttachWebSurface({
      primary: 'tui',
      session: result.session,
      vault: result.vault,
      config: result.config,
      write: () => {},
    });
    return result.session;
  };

  const shutdown = async (signal: NodeJS.Signals | 'normal'): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Force-exit guard for signal-driven shutdown: never hang holding the port /
    // a tunnel child if a stop() stalls. (Harmless on the normal-exit path, where
    // the process exits on its own and this unref'd timer is moot.)
    if (signal !== 'normal') {
      const force = setTimeout(() => process.exit(0), 4000);
      force.unref?.();
    }
    // Let an in-flight switch settle so we never close a half-booted session.
    await switching.catch(() => undefined);
    await teardownCurrent(signal);
    // Reap the collaboration coordinator we spawned (if any) — it's tied to our
    // process group, but SIGTERM lets its finally archive the run + release the
    // lock cleanly rather than dying abruptly with us.
    if (collabChild) {
      try {
        collabChild.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      collabChild = null;
    }
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    void shutdown(signal).then(() => process.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  /**
   * `/sessions` switch: tear down the live session (firing its onShutdown
   * hooks + releasing the socket), then boot the target — resuming its
   * persisted log, or a fresh session (a new id is minted by setup when none is
   * given). The TUI re-mounts onto the returned session. Serialized via
   * `switching` so overlapping picks / a racing shutdown can't interleave.
   */
  /**
   * Attach the TUI to the dedicated collaboration coordinator. Bare `/collab`
   * (no goal) attaches to a live coordinator to view it; with a goal — or when
   * none is running — spawn a fresh `moxxy collab` runner and connect. The goal
   * itself is auto-submitted by the re-mounted SessionView (via initialPrompt),
   * so its approval resolver is set before the roster checkpoint arrives.
   */
  const attachOrSpawnCollab = async (goal?: string): Promise<ClientSession> => {
    if (!goal) {
      const active = readActiveCollab();
      const runningSocket = active?.runnerSocket?.trim();
      if (runningSocket && (await isRunnerUp(runningSocket))) {
        return connectRemoteSession({ role: 'tui', socketPath: runningSocket, replay: 'full' });
      }
    }
    const entry = process.argv[1];
    if (!entry) throw new Error('cannot locate the moxxy CLI entrypoint to start a collaboration');
    const socket = collabCoordinatorSocketPath();
    // Reap a coordinator we spawned earlier before starting a fresh one.
    if (collabChild) {
      try {
        collabChild.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      collabChild = null;
    }
    // `detached: false` ties the coordinator to the TUI's process group, so it
    // dies with the TUI — matching the old in-chat collab's lifetime.
    collabChild = spawn(process.execPath, [entry, 'collab'], {
      cwd: tuiOpts.cwd ?? process.cwd(),
      env: {
        ...process.env,
        MOXXY_DEDICATED_RUNNER: '1',
        MOXXY_RUNNER_SOCKET: socket,
        MOXXY_SESSION_ID: `collab-${Date.now().toString(36)}`,
      },
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: false,
    });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !(await isRunnerUp(socket))) {
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!(await isRunnerUp(socket))) {
      throw new Error('the collaboration coordinator did not start in time');
    }
    return connectRemoteSession({ role: 'tui', socketPath: socket, replay: 'full' });
  };

  const switchSession = async (
    target: { kind: 'new' } | { kind: 'resume'; id: string } | { kind: 'collab'; goal?: string },
  ): Promise<ClientSession> => {
    if (shuttingDown) throw new Error('shutting down');
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });
    const prev = switching;
    switching = done;
    try {
      await prev.catch(() => undefined);
      if (shuttingDown) throw new Error('shutting down');
      await teardownCurrent('switch');
      if (target.kind === 'collab') {
        // The coordinator RemoteSession becomes the live session; teardownCurrent
        // on the next switch closes the client (the run keeps going).
        const session = await attachOrSpawnCollab(target.goal);
        bootedSession = session;
        return session;
      }
      return await bootSession(target.kind === 'resume' ? { resumeSessionId: target.id } : {});
    } finally {
      resolveDone();
    }
  };

  const { waitUntilExit } = render(
    React.createElement(InteractiveSession, {
      bootstrap: async (progress: (step: InteractiveBootStep) => void) =>
        bootSession(
          tuiOpts.resumeSessionId ? { resumeSessionId: tuiOpts.resumeSessionId } : {},
          progress,
        ),
      registerInteractiveResolver: (handler) => {
        promptHandler = handler;
      },
      getVault: () => bootedVault,
      getChannels: () => bootedChannels,
      switchSession,
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(version ? { version } : {}),
      ...(updateNotice ? { updateAvailable: updateNotice } : {}),
      ...(tuiOpts.resumeSessionId ? { resumed: true } : {}),
    }),
  );

  try {
    await waitUntilExit();
  } finally {
    await shutdown('normal');
  }
  return 0;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toInteractiveStep(step: BootStep): InteractiveBootStep {
  switch (step.kind) {
    case 'provider-activated':
      return { kind: 'provider-activated', detail: step.name };
    case 'provider-failed':
      return { kind: 'provider-failed', error: step.error };
    case 'plugins-registered':
      return { kind: 'plugins-registered', detail: `${step.count}` };
    case 'skills-loaded':
      return { kind: 'skills-loaded', detail: `${step.count}` };
    case 'config-loaded':
      return { kind: 'config-loaded' };
    case 'prefs-applied':
      return { kind: 'prefs-applied' };
    case 'init-hooks-done':
      return { kind: 'init-hooks-done' };
    case 'ready':
      return { kind: 'ready' };
  }
}
