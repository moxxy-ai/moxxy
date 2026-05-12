import { setupSessionWithConfig } from '../setup.js';
import type { ParsedArgv } from '../argv.js';

/**
 * Generic channel dispatcher. Looks up a ChannelDef by name in the session's
 * ChannelRegistry, instantiates it with the standard factory deps, swaps in
 * its PermissionResolver, and runs it.
 *
 * Channel-specific subcommands (e.g., `moxxy channels telegram pair`) live on
 * each `ChannelDef.subcommands` map and are dispatched by
 * `runChannelsCommand`. This is the code path for `moxxy <channel-name>` and
 * `moxxy channels <name>` when no subcommand is given.
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

  session.setPermissionResolver(channel.permissionResolver);

  // Build per-invocation start opts: well-known keys first, then any other
  // flags the caller forwarded (channel-specific, e.g., Telegram's `pair`).
  const reserved = new Set(['model', 'config', 'verbose']);
  const extraFlags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(argv.flags)) {
    if (reserved.has(k)) continue;
    extraFlags[k] = v;
  }
  const handle = await channel.start({
    session,
    model: argv.flags.model ? String(argv.flags.model) : undefined,
    ...extraFlags,
  } as never);

  const shutdown = async (): Promise<void> => {
    await handle.stop('SIGINT');
    // Fire onShutdown hooks so plugins can flush (memory journal, vault,
    // audit logs, etc.) before the process exits.
    await session.close('SIGINT').catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await handle.running;
  return 0;
}
