import {
  createInteractivePermissionResolver,
  InteractiveSession,
  loadPreferences,
  type InteractiveBootStep,
} from '@moxxy/plugin-cli';
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
import { spawn, spawnSync } from 'node:child_process';
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

  const prefs = await loadPreferences();
  const effectiveModel = stringFlag(argv, 'model') ?? prefs.model;
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

  const effectiveModel = stringFlag(argv, 'model') ?? (await loadPreferences()).model;
  const version = cliVersion();
  const updateNotice = resolveUpdateNotice(version);

  // Capture the resolved session + optional runner so shutdown can fire
  // `onShutdown` hooks and release the socket.
  let bootedSession: Session | null = null;
  let runnerServer: RunnerServer | null = null;
  let webHandle: ChannelHandle | null = null;
  let shuttingDown = false;

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
    await webHandle?.stop('shutdown').catch(() => undefined);
    await runnerServer?.close().catch(() => undefined);
    const s = bootedSession;
    bootedSession = null;
    if (!s) return;
    try {
      await s.close(signal === 'normal' ? undefined : signal);
    } catch {
      // Best-effort; never block process exit on cleanup errors.
    }
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    void shutdown(signal).then(() => process.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const { waitUntilExit } = render(
    React.createElement(InteractiveSession, {
      bootstrap: async (progress: (step: InteractiveBootStep) => void) => {
        const result = await setupSessionWithConfig({
          ...argvToSetupOptions(argv),
          resolver,
          onProgress: (step: BootStep) => progress(toInteractiveStep(step)),
          ...(tuiOpts.resumeSessionId ? { resumeSessionId: tuiOpts.resumeSessionId } : {}),
        });
        bootedSession = result.session;
        // Option A: open the socket so other clients can attach while this TUI
        // is open. A lost race (someone else bound first) just means we run
        // without sharing - not an error.
        if (!standalone) {
          try {
            runnerServer = await startRunnerServer(result.session);
          } catch {
            runnerServer = null;
          }
        }
        // Co-attach the web surface to THIS session so `present_view` returns a
        // real URL (local by default — no public tunnel for the TUI). `write` is
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
      },
      registerInteractiveResolver: (handler) => {
        promptHandler = handler;
      },
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
