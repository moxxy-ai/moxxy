import { setupSessionWithConfig } from '../setup.js';
import type { ParsedArgv } from '../argv.js';

export async function runChannelsCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';
  if (sub === 'list') {
    const { session, vault, config } = await setupSessionWithConfig({ cwd: process.cwd() });
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
    }
    return 0;
  }
  process.stderr.write(`unknown 'channels' subcommand: ${sub}\n  moxxy channels list\n`);
  return 2;
}
