import { isRunnerUp } from '@moxxy/runner';
import type { ChannelDef } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';
import { argvToSetupOptions, hasBoolFlag } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { probeSession, type SetupResult } from '../setup.js';
import { runTuiWithBootstrap } from './run-tui.js';
import { startRegisteredChannel } from './start-registered-channel.js';

/**
 * Smart channel dispatcher. Routes the `moxxy <channel>` invocation
 * through the appropriate frontend:
 *
 *   - tui      -> mounts Ink early, threads bootstrap progress into the boot screen
 *   - any      -> if the channel declares an `interactiveCommand` and we're on a
 *                 TTY (and not opting out), run that subcommand (a channel's
 *                 interactive setup); otherwise fall through to the headless
 *                 channel runner.
 *
 * The headless path lives in `start-registered-channel.ts`. The CLI knows
 * nothing about any specific channel here: the interactive-setup hook is
 * declared by the channel itself via `ChannelDef.interactiveCommand`.
 */
export async function runChannelByName(name: string, argv: ParsedArgv): Promise<number> {
  // The `tui` channel mounts its UI BEFORE running setup so the user
  // sees the logo + boot checklist instantly. Delegate to the TUI
  // helper, which threads progress callbacks into the bootstrap and
  // wires the permission resolver post-boot. (tui is the CLI's own
  // default UI, not a cross-package concern.)
  if (name === 'tui') return runTuiWithBootstrap(argv);

  // Light boot (a probe: no init hooks/daemons, no persistence, closed before
  // the headless runner below boots the REAL session) to read the channel
  // registry without activating a provider: the interactive-command path
  // (e.g. a setup wizard) does not run a turn.
  const outcome = await probeSession(
    argvToSetupOptions(argv, {
      skipKeyPrompt: true,
      tolerateNoProvider: true,
      skipProviderActivation: true,
    }),
    async ({ session, vault, config }): Promise<{ code: number } | 'start-headless'> => {
      const def = session.channels.get(name);
      if (!def) {
        printError(
          `unknown channel: ${name}\n  Available:\n` +
            session.channels.list().map((d) => `    ${d.name} - ${d.description}\n`).join(''),
        );
        return { code: 2 };
      }

      // A channel may declare an interactive setup subcommand shown by default
      // for TTY users. Bypass on:
      //   - non-TTY (cron / systemd / piped)
      //   - `--no-wizard` / `__skipWizard` (explicit opt-out / wizard hand-off,
      //     so the recursive call doesn't trampoline back into the menu)
      //   - `--standalone` (the user explicitly opts out of attaching)
      //   - a runner already being up: the user wants to attach/run, not
      //     configure, so go straight to the headless runner.
      if (
        def.interactiveCommand &&
        process.stdin.isTTY === true &&
        argv.flags['no-wizard'] !== true &&
        argv.flags['__skipWizard'] !== true &&
        !hasBoolFlag(argv, 'standalone') &&
        !(await isRunnerUp())
      ) {
        // The wizard uses this (daemon-less) probe session directly; its
        // `startChannel` hand-off recurses into runChannelByName, which boots
        // its own real session — so the probe never needs init hooks.
        return {
          code: await runChannelSubcommand(def, def.interactiveCommand, {
            session,
            vault,
            config,
            argv,
          }),
        };
      }

      return 'start-headless';
    },
  );
  if (outcome !== 'start-headless') return outcome.code;

  // Probe is closed; the headless path boots the real session (with init
  // hooks, so the daemons run exactly once, in the session that owns them).
  return startRegisteredChannel(name, argv);
}

/**
 * Build the full {@link ChannelSubcommandContext} (deps + args + startChannel +
 * session) for a channel subcommand and run it. Shared by the
 * `moxxy channels <name> <sub>` dispatcher and the bare `moxxy <name>`
 * interactive-command path, so the ctx is constructed identically in both.
 *
 * Lives here alongside `runChannelByName` because the two are mutually
 * recursive — a subcommand's `startChannel` callback routes back through
 * `runChannelByName`. Co-locating them keeps the module graph acyclic.
 *
 * `argv.positional` carries the subcommand's positional args (callers strip the
 * `<name> <sub>` prefix); `argv.flags` are forwarded as both the subcommand
 * flags and the channel options overrides.
 */
export async function runChannelSubcommand(
  def: ChannelDef,
  subName: string,
  ctx: {
    session: SetupResult['session'];
    vault: SetupResult['vault'];
    config: SetupResult['config'];
    argv: ParsedArgv;
  },
): Promise<number> {
  const { session, vault, config, argv } = ctx;
  const subcommand = def.subcommands?.[subName];
  if (!subcommand) {
    const available = def.subcommands
      ? Object.entries(def.subcommands)
          .map(([n, c]) => `    ${def.name} ${n}  — ${c.description}\n`)
          .join('')
      : '    (none)\n';
    printError(
      `unknown '${def.name}' subcommand: ${subName}\n  Available subcommands:\n${available}`,
    );
    return 2;
  }

  const configOpts = (config.channels?.[def.name] ?? {}) as Record<string, unknown>;
  const deps = {
    cwd: process.cwd(),
    vault,
    logger: session.logger,
    options: { ...configOpts, ...argv.flags },
  };

  return await subcommand.run({
    deps,
    args: {
      positional: argv.positional,
      flags: argv.flags,
    },
    session,
    startChannel: (extra) => {
      // Coerce extra opts into the ParsedArgv.flags shape (string | boolean).
      // ChannelSubcommand.startChannel accepts arbitrary unknown values for
      // forward compatibility, but these flow back into a fresh channel boot
      // where they may be parsed as ports/tokens. Only forward values that are
      // already a flag-shaped scalar (string/boolean) or a finite number;
      // silently String()-coercing an object/array would inject
      // `[object Object]` / comma-joined garbage at a trust-relevant boundary,
      // so DROP those (with a visible warning) rather than passing nonsense on.
      const extraFlags: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(extra ?? {})) {
        if (typeof v === 'string' || typeof v === 'boolean') extraFlags[k] = v;
        else if (typeof v === 'number' && Number.isFinite(v)) extraFlags[k] = String(v);
        else if (v !== undefined && v !== null) {
          session.logger.warn?.(
            `channel "${def.name}": dropping non-scalar start option "${k}" (${typeof v}) — only string/boolean/number flags are forwarded`,
          );
        }
      }
      const merged: ParsedArgv = {
        command: argv.command,
        flags: { ...argv.flags, ...extraFlags },
        positional: [],
      };
      return runChannelByName(def.name, merged);
    },
  });
}
