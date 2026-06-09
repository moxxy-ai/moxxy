import type { ParsedArgv } from '../argv.js';
import { colors } from '../colors.js';
import { probeSession } from '../setup.js';
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

  // `run` dispatches a real prompt — it boots its own full session.
  if (sub === 'run') return runScheduleNow(argv);

  // All other non-daemon paths need the store but NOT the provider — and
  // definitely not the init-hook daemons (a scheduler poller's first tick
  // could fire a due schedule mid-`moxxy schedule list`, and the webhooks
  // listener would steal the daemon's port). Probe: no init hooks, no
  // persistence, session closed before returning. tolerateNoProvider keeps
  // 'moxxy schedule list' working pre-init.
  return probeSession(
    {
      cwd: process.cwd(),
      skipKeyPrompt: true,
      tolerateNoProvider: true,
    },
    async ({ scheduler }) => {
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
        default:
          process.stderr.write(colors.red(`unknown subcommand: ${sub}`) + '\n' + SCHEDULE_HELP);
          return 2;
      }
    },
  );
}
