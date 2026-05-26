import type { ChannelDef, ChannelSubcommand } from '@moxxy/sdk';
import { bootSessionWithConfig, helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import type { ParsedArgv } from '../argv.js';
import { runChannelByName, runChannelSubcommand } from './run-channel.js';
import { colors } from '../colors.js';

/**
 * `moxxy channels` dispatcher.
 *
 *  - `moxxy channels`                       list registered channels and their availability
 *  - `moxxy channels <name>`                boot and run a channel by name (same as `moxxy <name>`)
 *  - `moxxy channels <name> --help`         show <name>'s description + subcommands (no boot)
 *  - `moxxy channels <name> <sub>`          invoke a channel-defined subcommand
 *  - `moxxy channels <name> <sub> --help`   show that subcommand's help (no boot)
 *
 * The CLI knows nothing about specific channels: every channel-specific
 * command lives on its `ChannelDef.subcommands` map.
 */
export async function runChannelsCommand(argv: ParsedArgv): Promise<number> {
  const [name, sub, ...rest] = argv.positional;

  if (!name || name === 'list') {
    return runList();
  }

  // Channel-introspection paths (read def, list subcommands) only need
  // the registry — they don't run a turn, so they MUST NOT boot the
  // provider. The previous flow inherited the full session boot from
  // `runChannelByName`, which threw "No working provider key" on
  // `moxxy channels telegram --help` despite the user having no need
  // for a provider at all.
  const { session, vault, config } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    skipProviderActivation: true,
  });

  const def = session.channels.get(name);
  if (!def) {
    printError(
      `unknown channel: ${name}\n  Available:\n` +
        session.channels.list().map((d) => `    ${d.name} — ${d.description}\n`).join(''),
    );
    return 2;
  }

  // No subcommand → either show help (--help/-h) or actually run the
  // channel. Running falls through to the full provider-booting path.
  if (!sub) {
    if (helpRequested(argv)) {
      process.stdout.write(formatChannelHelp(def));
      return 0;
    }
    return await runChannelByName(name, argv);
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
    return 2;
  }

  // Subcommand --help: print its description, don't run anything.
  if (helpRequested(argv)) {
    process.stdout.write(formatSubcommandHelp(name, sub, subcommand));
    return 0;
  }

  return await runChannelSubcommand(def, sub, {
    session,
    vault,
    config,
    argv: { ...argv, positional: rest },
  });
}

async function runList(): Promise<number> {
  // Same as above: the list command doesn't need a provider; force
  // skipProviderActivation so `moxxy channels` is instant even when
  // no API key is configured.
  const { session, vault, config } = await bootSessionWithConfig(
    { flags: {} },
    { skipKeyPrompt: true, tolerateNoProvider: true, skipProviderActivation: true },
  );
  const deps = {
    cwd: process.cwd(),
    vault,
    logger: session.logger,
    options: {},
  };
  const entries = await session.channels.listWithAvailability(deps);

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
    if (def.subcommands) {
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
