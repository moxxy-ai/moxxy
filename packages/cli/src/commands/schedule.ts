import type { ParsedArgv } from '../argv.js';
import { colors } from '../colors.js';
import { setupSessionWithConfig } from '../setup.js';
import { SCHEDULE_HELP } from './schedule/help.js';
import { runDaemon } from './schedule/daemon.js';
import { runScheduleSetup } from './schedule/setup-cmd.js';
import {
  addSchedule,
  listSchedules,
  removeSchedule,
  runScheduleNow,
  toggleSchedule,
} from './schedule/handlers.js';

export async function runScheduleCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';

  if (sub === 'help' || sub === '--help' || sub === '-h' || argv.flags['help'] === true) {
    process.stdout.write(SCHEDULE_HELP);
    return 0;
  }

  if (sub === 'setup') return await runScheduleSetup(argv);
  if (sub === 'daemon') return await runDaemon(argv);

  // All non-daemon paths need the store but NOT the provider, so we
  // can short-circuit setup if it ever offers that mode. For now,
  // setupSessionWithConfig is the only setup entry — call it with
  // tolerateNoProvider so 'moxxy schedule list' works pre-init.
  const { scheduler } = await setupSessionWithConfig({
    cwd: process.cwd(),
    skipKeyPrompt: true,
    tolerateNoProvider: true,
  });

  switch (sub) {
    case 'list':
      return listSchedules(scheduler.store);
    case 'add':
      return addSchedule(scheduler.store, argv);
    case 'remove':
      return removeSchedule(scheduler.store, argv);
    case 'enable':
    case 'disable':
      return toggleSchedule(scheduler.store, argv, sub);
    case 'run':
      return runScheduleNow(argv);
    default:
      process.stderr.write(colors.red(`unknown subcommand: ${sub}`) + '\n' + SCHEDULE_HELP);
      return 2;
  }
}
