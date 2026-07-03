import type { ChannelDef, ChannelRunStatus, ChannelSubcommand } from '@moxxy/sdk';
import {
  clearChannelStatus,
  liveChannelStatus,
  listLiveChannelStatuses,
  spawnDedicatedChannel,
  stopDedicatedChannel,
} from '@moxxy/sdk/server';
import { argvToSetupOptions, helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import type { ParsedArgv } from '../argv.js';
import { probeSession } from '../setup.js';
import { runChannelByName, runChannelSubcommand } from './run-channel.js';
import { colors } from '../colors.js';

/**
 * `moxxy channels` dispatcher.
 *
 *  - `moxxy channels`                       list registered channels and their availability
 *  - `moxxy channels status [name]`         list the DETACHED channels currently running
 *  - `moxxy channels start <name>`          start a channel on its own detached runner
 *  - `moxxy channels stop <name>`           stop a detached channel
 *  - `moxxy channels <name>`                boot and run a channel by name (same as `moxxy <name>`)
 *  - `moxxy channels <name> --help`         show <name>'s description + subcommands (no boot)
 *  - `moxxy channels <name> <sub>`          invoke a channel-defined subcommand
 *  - `moxxy channels <name> <sub> --help`   show that subcommand's help (no boot)
 *
 * `start`/`stop`/`status` run a channel DETACHED on its own dedicated runner — it
 * outlives this process and is controllable from anywhere (the TUI `/channels`
 * panel, the desktop panel) via its status file. `moxxy <channel>` (and
 * `moxxy channels <name>`) still run it in the FOREGROUND.
 *
 * The CLI knows nothing about specific channels: every channel-specific
 * command lives on its `ChannelDef.subcommands` map.
 */
export async function runChannelsCommand(argv: ParsedArgv): Promise<number> {
  const [name, sub, ...rest] = argv.positional;

  if (!name || name === 'list') {
    return runList(argv);
  }

  // Lifecycle verbs (reserved first-positionals — no channel is named these).
  // These manage channels that run DETACHED on their own dedicated runner: a
  // channel started here keeps serving after this process exits, and is
  // discovered/stopped process-independently via its status file. Distinct from
  // `moxxy channels <name> <sub>` (e.g. `moxxy channels telegram status`), where
  // the channel name comes first.
  if (name === 'status') return runStatus(argv.positional[1]);
  if (name === 'start') return runStart(argv);
  if (name === 'stop') return runStop(argv);

  // Channel-introspection paths (read def, list subcommands) only need
  // the registry — they don't run a turn, so they MUST NOT boot the
  // provider. The previous flow inherited the full session boot from
  // `runChannelByName`, which threw "No working provider key" on
  // `moxxy channels telegram --help` despite the user having no need
  // for a provider at all. probeSession additionally skips the init-hook
  // daemons and closes the session before returning, so falling through
  // to `runChannelByName` (which boots the REAL session) never leaves an
  // orphaned session holding the webhooks port / a duplicate scheduler.
  const outcome = await probeSession(
    argvToSetupOptions(argv, {
      skipKeyPrompt: true,
      tolerateNoProvider: true,
      skipProviderActivation: true,
    }),
    async ({ session, vault, config }): Promise<{ code: number } | 'run-channel'> => {
      const def = session.channels.get(name);
      if (!def) {
        // Slim kernel: a known channel may simply not be installed yet.
        const { findCatalogEntryForChannel } = await import('../channel-hints.js');
        const hint = findCatalogEntryForChannel(name);
        if (hint) {
          printError(
            `channel not installed: ${name}\n` +
              `  install it with: moxxy plugins install ${hint.id}\n` +
              `  (or from the TUI: /plugins → Installable → ${hint.label})`,
          );
          return { code: 2 };
        }
        printError(
          `unknown channel: ${name}\n  Available:\n` +
            session.channels.list().map((d) => `    ${d.name} — ${d.description}\n`).join(''),
        );
        return { code: 2 };
      }

      // No subcommand → either show help (--help/-h) or actually run the
      // channel. Running falls through (after the probe closes) to the full
      // provider-booting path.
      if (!sub) {
        if (helpRequested(argv)) {
          process.stdout.write(formatChannelHelp(def));
          return { code: 0 };
        }
        return 'run-channel';
      }

      const subcommand = def.subcommands?.[sub];
      if (!subcommand) {
        const available = def.subcommands
          ? Object.entries(def.subcommands)
              .map(([n, c]) => `    ${name} ${n}  — ${c.description}\n`)
              .join('')
          : '    (none)\n';
        printError(
          `unknown '${name}' subcommand: ${sub}\n  Available subcommands:\n${available}`,
        );
        return { code: 2 };
      }

      // Subcommand --help: print its description, don't run anything.
      if (helpRequested(argv)) {
        process.stdout.write(formatSubcommandHelp(name, sub, subcommand));
        return { code: 0 };
      }

      return {
        code: await runChannelSubcommand(def, sub, {
          session,
          vault,
          config,
          argv: { ...argv, positional: rest },
        }),
      };
    },
  );
  if (outcome !== 'run-channel') return outcome.code;
  return runChannelByName(name, argv);
}

async function runList(argv: ParsedArgv): Promise<number> {
  // Same as above: the list command doesn't need a provider; force
  // skipProviderActivation so `moxxy channels` is instant even when
  // no API key is configured. Probe semantics: no init-hook daemons,
  // session closed before we print. Thread the real argv so
  // `--config`/`--verbose`/`--model` are honored when listing
  // availability (otherwise a custom config is silently ignored).
  const { entries, config } = await probeSession(
    argvToSetupOptions(argv, {
      skipKeyPrompt: true,
      tolerateNoProvider: true,
      skipProviderActivation: true,
    }),
    async ({ session, vault, config }) => ({
      config,
      entries: await session.channels.listWithAvailability({
        cwd: process.cwd(),
        vault,
        logger: session.logger,
        options: {},
      }),
    }),
  );

  // Layout: bold name + status label aligned in columns, then a dim
  // description below each. Subcommands indented under their parent.
  // Mono palette only — bold + dim, no green/yellow/cyan, matching
  // the TUI redesign.
  const nameCol = Math.max(8, ...entries.map((e) => e.def.name.length));
  for (const { def, availability } of entries) {
    const namePadded = def.name.padEnd(nameCol);
    const status = availability.ok ? 'available' : 'unavailable';
    const configured = config.channels?.[def.name] ? '  · configured' : '';
    process.stdout.write(
      `${colors.bold(namePadded)}  ${colors.dim(status + configured)}\n`,
    );
    if (!availability.ok && availability.reason) {
      // Reason on its own dim row so it can't push the description
      // column off-screen. Wrap once if it really exceeds terminal
      // width — but keep the indent stable.
      process.stdout.write(`${' '.repeat(nameCol + 2)}${colors.dim('└ ' + availability.reason)}\n`);
    }
    process.stdout.write(`${' '.repeat(nameCol + 2)}${colors.dim(def.description)}\n`);
    if (def.subcommands && Object.keys(def.subcommands).length > 0) {
      const subNameCol = Math.max(
        ...Object.keys(def.subcommands).map((s) => `${def.name} ${s}`.length),
      );
      for (const [subName, sc] of Object.entries(def.subcommands)) {
        const label = `${def.name} ${subName}`.padEnd(subNameCol);
        process.stdout.write(
          `${' '.repeat(nameCol + 2)}${colors.dim('· ' + label)}  ${colors.dim(sc.description)}\n`,
        );
      }
    }
    process.stdout.write('\n');
  }
  return 0;
}

/**
 * `moxxy channels status [name]` — list the running dedicated channels (or one
 * by name). Pure status-file read: no session boot, instant, works even with no
 * provider configured. Self-heals stale files (a crashed runner's pid is dead).
 */
async function runStatus(only?: string): Promise<number> {
  const running = only
    ? ([liveChannelStatus(only)].filter(Boolean) as ChannelRunStatus[])
    : listLiveChannelStatuses();
  if (running.length === 0) {
    process.stdout.write(colors.dim(only ? `${only} is not running\n` : 'no channels running\n'));
    return 0;
  }
  running.sort((a, b) => a.name.localeCompare(b.name));
  const nameCol = Math.max(8, ...running.map((s) => s.name.length));
  for (const s of running) {
    process.stdout.write(
      `${colors.bold(s.name.padEnd(nameCol))}  ${colors.dim(`running · pid ${s.pid} · up ${formatUptime(s.startedAt)}`)}\n`,
    );
    if (s.requestUrl) {
      process.stdout.write(`${' '.repeat(nameCol + 2)}${colors.dim('Request URL: ' + s.requestUrl)}\n`);
    }
  }
  return 0;
}

/**
 * `moxxy channels start <name>` — start a channel on its own dedicated, DETACHED
 * runner (it keeps serving after this command returns). Validates the channel
 * exists and is configured (via its own `isAvailable` gate, which honors env +
 * vault), spawns it, then waits for its status file to confirm readiness.
 */
async function runStart(argv: ParsedArgv): Promise<number> {
  const channelName = argv.positional[1];
  if (!channelName) {
    printError('usage: moxxy channels start <name>');
    return 2;
  }

  // Idempotent: a live status file means it's already up (started here, by the
  // desktop panel, or by the TUI — all share the same status file).
  const existing = liveChannelStatus(channelName);
  if (existing) {
    process.stdout.write(
      `${colors.bold(channelName)} ${colors.dim(`already running (pid ${existing.pid})`)}\n`,
    );
    if (existing.requestUrl) {
      process.stdout.write(`  ${colors.dim('Request URL: ' + existing.requestUrl)}\n`);
    }
    return 0;
  }

  // Validate against the live registry before spawning. probeSession skips the
  // provider + init-hook daemons and closes the session before returning, so we
  // never leave an orphaned session; the spawned runner boots its own.
  const check = await probeSession(
    argvToSetupOptions(argv, {
      skipKeyPrompt: true,
      tolerateNoProvider: true,
      skipProviderActivation: true,
    }),
    async ({ session, vault }): Promise<{ code: number } | { ok: true; def: ChannelDef }> => {
      const def = session.channels.get(channelName);
      if (!def) {
        printError(unknownChannelMessage(channelName, session.channels.list()));
        return { code: 2 };
      }
      const avail = def.isAvailable
        ? await def.isAvailable({ cwd: process.cwd(), vault, logger: session.logger, options: {} })
        : { ok: true as const };
      if (!avail.ok) {
        printError(
          `${channelName} is not ready to start: ${avail.reason ?? 'not configured'}\n` +
            `  Configure it in the TUI (/channels) or run \`moxxy ${channelName} setup\`.`,
        );
        return { code: 1 };
      }
      return { ok: true, def };
    },
  );
  if ('code' in check) return check.code;

  spawnDedicatedChannel(channelName);
  const status = await waitForChannelStatus(channelName, check.def);
  if (!status) {
    printError(
      `${channelName} did not report ready within ${Math.round(START_TIMEOUT_MS / 1000)}s — it may have failed to start.\n` +
        `  Run \`moxxy ${channelName}\` in the foreground to see the error.`,
    );
    return 1;
  }
  process.stdout.write(`${colors.bold(channelName)} ${colors.dim(`started (pid ${status.pid})`)}\n`);
  if (status.requestUrl) {
    process.stdout.write(`  ${colors.dim('Request URL: ' + status.requestUrl)}\n`);
  }
  if (check.def.config?.runHint) {
    process.stdout.write(`  ${colors.dim(check.def.config.runHint)}\n`);
  }
  return 0;
}

/**
 * `moxxy channels stop <name>` — SIGTERM the channel's runner. The runner clears
 * its own status file on graceful shutdown; if it ignores the term within the
 * grace window we SIGKILL and clear the file ourselves. Pure status-file path —
 * no session boot.
 */
async function runStop(argv: ParsedArgv): Promise<number> {
  const channelName = argv.positional[1];
  if (!channelName) {
    printError('usage: moxxy channels stop <name>');
    return 2;
  }
  const before = liveChannelStatus(channelName);
  if (stopDedicatedChannel(channelName) === 'not-running') {
    process.stdout.write(`${colors.bold(channelName)} ${colors.dim('is not running')}\n`);
    return 0;
  }
  const gone = await waitForChannelGone(channelName);
  if (!gone && before) {
    try {
      process.kill(before.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    clearChannelStatus(channelName);
  }
  process.stdout.write(`${colors.bold(channelName)} ${colors.dim('stopped')}\n`);
  return 0;
}

/** How long `start` waits for the runner to publish its status file. */
const START_TIMEOUT_MS = 15_000;
/** How long `stop` waits for graceful shutdown before the SIGKILL backstop. */
const STOP_GRACE_MS = 4_000;
const POLL_MS = 300;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll for the channel's status file, resolving once it's live (and, for a
 *  channel that exposes a Request URL, once that URL is present). */
async function waitForChannelStatus(
  name: string,
  def: ChannelDef,
): Promise<ChannelRunStatus | null> {
  const needsUrl = def.config?.hasRequestUrl === true;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = liveChannelStatus(name);
    if (status && (!needsUrl || status.requestUrl)) return status;
    await delay(POLL_MS);
  }
  return liveChannelStatus(name); // last read — report it even without a URL
}

/** Poll until the channel's status file is gone (graceful shutdown), or the
 *  grace window elapses. */
async function waitForChannelGone(name: string): Promise<boolean> {
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    if (!liveChannelStatus(name)) return true;
    await delay(POLL_MS);
  }
  return liveChannelStatus(name) === null;
}

/** "12s" / "4m" / "1h 3m" since an ISO timestamp. */
function formatUptime(startedAt: string): string {
  const ms = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Shared "unknown channel" message (mirrors the inline one in the dispatcher). */
function unknownChannelMessage(name: string, available: ReadonlyArray<ChannelDef>): string {
  return (
    `unknown channel: ${name}\n  Available:\n` +
    available.map((d) => `    ${d.name} — ${d.description}\n`).join('')
  );
}

function formatChannelHelp(def: ChannelDef): string {
  const lines: string[] = [];
  lines.push(`${colors.bold(`moxxy channels ${def.name}`)}`);
  lines.push(`  ${colors.dim(def.description)}`);
  lines.push('');
  lines.push(`  Run with:   ${colors.dim(`moxxy ${def.name}`)}`);
  if (def.subcommands && Object.keys(def.subcommands).length > 0) {
    lines.push('');
    lines.push(`  ${colors.dim('Subcommands:')}`);
    const sub = def.subcommands;
    const w = Math.max(...Object.keys(sub).map((s) => s.length));
    for (const [subName, sc] of Object.entries(sub)) {
      lines.push(`    ${colors.bold(subName.padEnd(w))}  ${colors.dim(sc.description)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function formatSubcommandHelp(
  channelName: string,
  subName: string,
  sub: ChannelSubcommand,
): string {
  const lines: string[] = [];
  lines.push(`${colors.bold(`moxxy channels ${channelName} ${subName}`)}`);
  lines.push(`  ${colors.dim(sub.description)}`);
  return lines.join('\n') + '\n';
}
