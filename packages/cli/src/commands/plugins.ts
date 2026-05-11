import { setupSession } from '../setup.js';
import type { ParsedArgv } from '../argv.js';

export async function runPluginsCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';
  const session = await setupSession({ cwd: process.cwd() });
  if (sub === 'list') {
    for (const p of session.pluginHost.list()) {
      process.stdout.write(`${p.name}@${p.version}\n`);
    }
    return 0;
  }
  if (sub === 'reload') {
    await session.pluginHost.reload();
    process.stdout.write('reload complete\n');
    return 0;
  }
  process.stderr.write(`unknown 'plugins' subcommand: ${sub}\n`);
  return 2;
}
