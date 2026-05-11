import { setupSessionWithConfig } from '../setup.js';
import type { ParsedArgv } from '../argv.js';

/**
 * Generic channel dispatcher. Looks up a ChannelDef by name in the session's
 * ChannelRegistry, instantiates it with the standard factory deps, swaps in
 * its PermissionResolver, and runs it.
 *
 * Channel-specific subcommands (`moxxy telegram pair`, `moxxy telegram status`)
 * still live in their own command modules — they need access to the channel
 * instance's pairing API, not just the generic Channel surface. This is the
 * code path for `moxxy <channel-name>` when no specialized subcommand exists.
 */
export async function runChannelByName(name: string, argv: ParsedArgv): Promise<number> {
  const { session, vault, config } = await setupSessionWithConfig({
    cwd: process.cwd(),
    verbose: Boolean(argv.flags.verbose),
    model: argv.flags.model ? String(argv.flags.model) : undefined,
    configPath: argv.flags.config ? String(argv.flags.config) : undefined,
  });

  const def = session.channels.get(name);
  if (!def) {
    process.stderr.write(
      `unknown channel: ${name}\n  Available:\n` +
        session.channels.list().map((d) => `    ${d.name} — ${d.description}\n`).join(''),
    );
    return 2;
  }

  // Merge sources, lowest → highest precedence: moxxy.config.ts → CLI flags.
  const configOpts = (config.channels?.[name] ?? {}) as Record<string, unknown>;
  const channel = def.create({
    cwd: process.cwd(),
    vault,
    logger: session.logger,
    options: { ...configOpts, ...argv.flags },
  });

  (session as unknown as { resolver: typeof channel.permissionResolver }).resolver =
    channel.permissionResolver;

  const handle = await channel.start({
    session,
    model: argv.flags.model ? String(argv.flags.model) : undefined,
  } as never);

  const shutdown = async (): Promise<void> => {
    await handle.stop('SIGINT');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await handle.running;
  return 0;
}
