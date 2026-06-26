import {
  connectRemoteSession,
  isRunnerUp,
  platformSocket,
  runnerSocketPath,
  startRunnerServer,
  type RemoteSession,
  type RunnerServer,
} from '@moxxy/runner';
import type { Session } from '@moxxy/core';
import { startChannelWith } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import type { ClientSession, SessionLike, SessionSource } from '@moxxy/sdk';
import {
  argvToSetupOptions,
  bootSessionWithConfig,
  hasBoolFlag,
  stringFlag,
} from '../argv-helpers.js';
import { setupSessionWithConfig } from '../setup.js';
import { printError } from '../errors.js';
import type { ParsedArgv } from '../argv.js';
import { chooseClientMode, collectExtraFlags } from './client-mode.js';
import { coAttachWebSurface } from './web-surface.js';

/**
 * Compile-time conformance lock for the runner/thin-client seam. Both session
 * implementations a channel ever receives — the thin-client `RemoteSession`
 * proxy and the in-process `@moxxy/core` `Session` — MUST stay assignable to
 * the typed views every channel is written against (`ClientSession`, and
 * through it `SessionLike`). If a future change narrows either implementation
 * or widens a *ClientView, this turns the regression into a compile error here
 * instead of forcing a cast back onto a dispatch call site below.
 */
type _AssertAssignable<_T extends _U, _U> = true;
type _RemoteIsClientSession = _AssertAssignable<RemoteSession, ClientSession>;
type _RemoteIsSessionLike = _AssertAssignable<RemoteSession, SessionLike>;
type _SessionIsClientSession = _AssertAssignable<Session, ClientSession>;
type _SessionIsSessionLike = _AssertAssignable<Session, SessionLike>;

/**
 * What a channel declares (via its {@link ChannelDef}) about running on its own
 * dedicated runner. Resolved by the dispatcher from the channel registry and
 * threaded in — `applyDedicatedRunnerEnv` runs before any session boots, so it
 * can't look the def up itself.
 */
export interface DedicatedRunnerOpts {
  /** The channel declared `dedicatedRunner: true`. */
  readonly dedicatedRunner?: boolean;
  /** The channel's declared `sessionSource` (stamped when running dedicated). */
  readonly sessionSource?: SessionSource;
}

/**
 * Run a registered channel by name, headlessly (no wizard, no TUI hand-off).
 *
 * Like `moxxy tui`, a channel is a thin client of the runner:
 *  - a runner is up (and not `--standalone`) -> attach over the socket and run
 *    the channel against a RemoteSession.
 *  - otherwise -> boot a local session and, unless `--standalone`, open the
 *    runner socket so other clients can attach too (Option A).
 *
 * `dedicated` carries the channel's own `ChannelDef` declaration (resolved by
 * the dispatcher); see {@link applyDedicatedRunnerEnv}.
 */
export async function startRegisteredChannel(
  name: string,
  argv: ParsedArgv,
  dedicated: DedicatedRunnerOpts = {},
): Promise<number> {
  applyDedicatedRunnerEnv(name, argv, dedicated);
  const standalone = hasBoolFlag(argv, 'standalone');
  const mode = chooseClientMode({ standalone, runnerUp: standalone ? false : await isRunnerUp() });
  if (mode === 'attach') return runAttachedChannel(name, argv);
  return runSelfHostedChannel(name, argv, mode === 'standalone');
}

/**
 * A channel may declare itself a "dedicated runner": it runs as its OWN agent
 * thread, isolated from whatever runner is serving the desktop/TUI, so it can
 * act separately from the user's own work. We achieve that purely by addressing
 * — a distinct runner socket + a stable sticky session id — with NO runner
 * protocol change: one dedicated runner is still one Session, today's invariant.
 *
 * The env is set BEFORE `chooseClientMode`/`isRunnerUp` run, so the channel
 * probes its own (empty) socket, falls into self-host mode, and boots an
 * isolated Session instead of attaching to the user's main runner. The stable
 * `MOXXY_SESSION_ID` persists that session's history across restarts.
 *
 * Whether a channel is dedicated is DECLARED by the channel itself
 * (`ChannelDef.dedicatedRunner`, resolved by the dispatcher and passed in via
 * `opts`) — the CLI keeps no per-channel name list. Any channel can also opt in
 * at runtime with `--dedicated` or `MOXXY_DEDICATED_RUNNER=1`. A caller that
 * already pinned the socket/session id/source (e.g. the desktop supervisor)
 * always wins — we only fill in what is unset.
 */
export function applyDedicatedRunnerEnv(
  name: string,
  argv: ParsedArgv,
  opts: DedicatedRunnerOpts,
): void {
  const dedicated =
    opts.dedicatedRunner === true ||
    hasBoolFlag(argv, 'dedicated') ||
    process.env.MOXXY_DEDICATED_RUNNER === '1';
  if (!dedicated) return;
  if (!process.env.MOXXY_RUNNER_SOCKET) {
    process.env.MOXXY_RUNNER_SOCKET = platformSocket(
      `channel-${name}`,
      moxxyPath(`channel-${name}.sock`),
    );
  }
  if (!process.env.MOXXY_SESSION_ID) {
    process.env.MOXXY_SESSION_ID = `moxxy-channel-${name}`;
  }
  if (!process.env.MOXXY_SESSION_SOURCE && opts.sessionSource) {
    process.env.MOXXY_SESSION_SOURCE = opts.sessionSource;
  }
}

/** Thin-client mode: run the channel against a RemoteSession. */
async function runAttachedChannel(name: string, argv: ParsedArgv): Promise<number> {
  // Register plugins so the channel factory is available, but skip init hooks
  // (no daemons - the runner owns those) and provider activation (turns run on
  // the runner). This is the "load the factory, don't boot a session" path.
  const setup = await setupSessionWithConfig({
    ...argvToSetupOptions(argv),
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    skipProviderActivation: true,
    skipInitHooks: true,
    disableSessionPersistence: true,
  });

  const def = setup.session.channels.get(name);
  if (!def) {
    printError(unknownChannelMessage(name, setup.session.channels.list()));
    return 2;
  }

  let remote;
  try {
    remote = await connectRemoteSession({ role: name });
  } catch (err) {
    printError(`failed to attach to the runner at ${runnerSocketPath()}: ${errMsg(err)}`);
    return 1;
  }

  const configOpts = (setup.config.channels?.[name] ?? {}) as Record<string, unknown>;
  const channel = def.create({
    cwd: process.cwd(),
    vault: setup.vault,
    logger: setup.session.logger,
    options: { ...configOpts, ...argv.flags },
  });
  remote.setPermissionResolver(channel.permissionResolver);

  // RemoteSession is a ClientSession (thin-client proxy); the seam holds.
  const handle = await startChannelWith(channel, {
    session: remote,
    model: stringFlag(argv, 'model'),
    ...collectExtraFlags(argv),
  });

  let stopping = false;
  const shutdown = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await handle.stop('SIGINT');
    await remote.close().catch(() => undefined);
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  // Runner gone: exit non-zero so a supervisor (systemd/launchd) restarts us,
  // and we reattach to whatever runner is up next.
  remote.onClose(() => {
    if (stopping) return;
    process.stderr.write('runner disconnected - exiting (will reattach on restart).\n');
    void shutdown(1);
  });

  await handle.running;
  return 0;
}

/** Self-host mode: boot a local session and (unless standalone) open the socket. */
async function runSelfHostedChannel(
  name: string,
  argv: ParsedArgv,
  standalone: boolean,
): Promise<number> {
  // `skipKeyPrompt: true` - channels like telegram run for hours; if the model
  // key resolves later from env/vault when a turn fires, that's fine. The
  // interactive readline prompt would race the channel's event loop.
  const { session, vault, config } = await bootSessionWithConfig(argv, { skipKeyPrompt: true });

  const def = session.channels.get(name);
  if (!def) {
    printError(unknownChannelMessage(name, session.channels.list()));
    return 2;
  }

  const configOpts = (config.channels?.[name] ?? {}) as Record<string, unknown>;
  const channel = def.create({
    cwd: process.cwd(),
    vault,
    logger: session.logger,
    options: { ...configOpts, ...argv.flags },
  });

  session.setPermissionResolver(channel.permissionResolver);

  // Open the runner socket so other clients can attach while this channel is
  // up (Option A). A lost race just means no sharing, not an error.
  let runnerServer: RunnerServer | null = null;
  if (!standalone) {
    try {
      runnerServer = await startRunnerServer(session);
    } catch {
      runnerServer = null;
    }
  }

  // The in-process Session satisfies ClientSession; the seam holds.
  const handle = await startChannelWith(channel, {
    session,
    model: stringFlag(argv, 'model'),
    ...collectExtraFlags(argv),
  });

  // Co-attach the web surface to the SAME session (on by default) so
  // present_view renders and the agent can hand the user a URL even when the
  // primary channel is e.g. telegram. The primary's permission resolver governs.
  const webHandle = name === 'web' ? null : await coAttachWebSurface({ primary: name, session, vault, config });

  // Re-entrancy guard (mirrors runAttachedChannel): a second Ctrl-C, or
  // SIGINT+SIGTERM arriving close together, must not run teardown twice —
  // session.close() firing twice can double-flush plugin state (memory
  // journal, vault) and a second process.exit would race the first.
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // Force-exit backstop (matches serve.ts / run-tui.ts): if a handle.stop()
    // or session.close() wedges (a stuck channel event loop, a plugin
    // onShutdown that never resolves), never strand the process holding the
    // runner socket + bound ports — a second Ctrl-C is swallowed by `stopping`.
    const force = setTimeout(() => process.exit(0), 4000);
    force.unref?.();
    await webHandle?.stop('SIGINT').catch(() => undefined);
    await runnerServer?.close().catch(() => undefined);
    await handle.stop('SIGINT');
    // Fire onShutdown hooks so plugins can flush (memory journal, vault, etc.).
    await session.close('SIGINT').catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await handle.running;
  return 0;
}

function unknownChannelMessage(
  name: string,
  available: ReadonlyArray<{ name: string; description: string }>,
): string {
  return (
    `unknown channel: ${name}\n  Available:\n` +
    available.map((d) => `    ${d.name} - ${d.description}\n`).join('')
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
