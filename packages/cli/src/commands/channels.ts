import { setupSessionWithConfig } from '../setup.js';
import type { ParsedArgv } from '../argv.js';
import { runChannelByName } from './run-channel.js';

/**
 * `moxxy channels` dispatcher.
 *
 *  - `moxxy channels`               list registered channels and their availability
 *  - `moxxy channels <name>`        boot and run a channel by name (same as `moxxy <name>`)
 *  - `moxxy channels <name> <sub>`  invoke a channel-defined subcommand (e.g.,
 *                                    `moxxy channels telegram pair|unpair|status`)
 *
 * The CLI knows nothing about specific channels: every channel-specific
 * command lives on its `ChannelDef.subcommands` map.
 */
export async function runChannelsCommand(argv: ParsedArgv): Promise<number> {
  const [name, sub, ...rest] = argv.positional;

  if (!name || name === 'list') {
    return runList(argv);
  }

  const { session, vault, config } = await setupSessionWithConfig({
    cwd: process.cwd(),
    verbose: Boolean(argv.flags.verbose),
    model: argv.flags.model ? String(argv.flags.model) : undefined,
    configPath: argv.flags.config ? String(argv.flags.config) : undefined,
    skipKeyPrompt: true,
  });

  const def = session.channels.get(name);
  if (!def) {
    process.stderr.write(
      `unknown channel: ${name}\n  Available:\n` +
        session.channels.list().map((d) => `    ${d.name} — ${d.description}\n`).join(''),
    );
    return 2;
  }

  // No subcommand → run the channel itself.
  if (!sub) {
    return await runChannelByName(name, argv);
  }

  const subcommand = def.subcommands?.[sub];
  if (!subcommand) {
    const available = def.subcommands
      ? Object.entries(def.subcommands)
          .map(([n, c]) => `    ${name} ${n}  — ${c.description}\n`)
          .join('')
      : '    (none)\n';
    process.stderr.write(
      `unknown '${name}' subcommand: ${sub}\n  Available subcommands:\n${available}`,
    );
    return 2;
  }

  const configOpts = (config.channels?.[name] ?? {}) as Record<string, unknown>;
  const deps = {
    cwd: process.cwd(),
    vault,
    logger: session.logger,
    options: { ...configOpts, ...argv.flags },
  };

  return await subcommand.run({
    deps,
    args: {
      positional: rest,
      flags: argv.flags,
    },
    startChannel: (extra) =>
      runChannelByName(name, {
        ...argv,
        flags: { ...argv.flags, ...(extra ?? {}) },
        positional: [],
      } as ParsedArgv),
  });
}

async function runList(argv: ParsedArgv): Promise<number> {
  const { session, vault, config } = await setupSessionWithConfig({
    cwd: process.cwd(),
    skipKeyPrompt: true,
  });
  const deps = {
    cwd: process.cwd(),
    vault,
    logger: session.logger,
    options: {},
  };
  const entries = await session.channels.listWithAvailability(deps);
  for (const { def, availability } of entries) {
    const status = availability.ok ? 'ok' : `unavailable: ${availability.reason ?? ''}`;
    const configured = config.channels?.[def.name] ? ' [configured]' : '';
    process.stdout.write(`${def.name}\t[${status}]${configured}\t${def.description}\n`);
    if (def.subcommands) {
      for (const [subName, sc] of Object.entries(def.subcommands)) {
        process.stdout.write(`  ${def.name} ${subName}\t${sc.description}\n`);
      }
    }
  }
  void argv;
  return 0;
}
