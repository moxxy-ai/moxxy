import type { ParsedArgv } from '../../argv.js';
import { colors } from '../../colors.js';
import { setupSessionWithConfig } from '../../setup.js';
import {
  getDaemonStatus,
  installAndStartDaemon,
  stopAndUninstallDaemon,
} from '../schedule-daemon-svc.js';

/**
 * `daemon` has four modes:
 *   1. (default) — run the poller in the foreground until ^C.
 *   2. --background — install an OS unit and exit immediately.
 *   3. --stop      — uninstall the OS unit.
 *   4. --status    — report whether the OS unit is loaded + running.
 */
export async function runDaemon(argv: ParsedArgv): Promise<number> {
  if (argv.flags.stop) return runDaemonStop();
  if (argv.flags.status) return runDaemonStatus();
  if (argv.flags.background) return runDaemonBackground();
  return runDaemonForeground();
}

async function runDaemonStop(): Promise<number> {
  const result = await stopAndUninstallDaemon();
  process.stdout.write(
    `${result.ok ? colors.bold('stopped') : colors.red('failed')}  ${colors.dim(result.message)}\n`,
  );
  return result.ok ? 0 : 1;
}

async function runDaemonStatus(): Promise<number> {
  const status = await getDaemonStatus();
  if (status.platform === 'unsupported') {
    process.stdout.write(colors.red('background daemon is unsupported on this platform') + '\n');
    return 1;
  }
  const rows: Array<[string, string]> = [
    ['platform', status.platform],
    ['installed', status.installed ? 'yes' : 'no'],
    ['running', status.running ? 'yes' : 'no'],
  ];
  if (status.unitPath) rows.push(['unit', status.unitPath]);
  if (status.logPath) rows.push(['log', status.logPath]);
  const col = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    process.stdout.write(`${colors.bold(k.padEnd(col))}  ${colors.dim(v)}\n`);
  }
  return 0;
}

async function runDaemonBackground(): Promise<number> {
  const result = await installAndStartDaemon();
  process.stdout.write(
    `${result.ok ? colors.bold('started') : colors.red('failed')}  ${colors.dim(result.message)}\n`,
  );
  if (result.ok) {
    process.stdout.write(
      colors.dim(`         logs: ${result.logPath}\n         manage: moxxy schedule daemon --status|--stop\n`),
    );
  }
  return result.ok ? 0 : 1;
}

async function runDaemonForeground(): Promise<number> {
  // Boot a full session and idle while the poller (installed by the
  // scheduler plugin's onInit hook) ticks.
  const { session, scheduler } = await setupSessionWithConfig({ cwd: process.cwd() });
  process.stdout.write(
    `${colors.bold('scheduler daemon')}  ${colors.dim('provider=' + (session.providers.getActiveName() ?? '(none)'))}\n` +
      colors.dim('                 ^C to stop. Schedules fire while this process is alive.\n'),
  );
  let stopRequested = false;
  const shutdown = async (): Promise<void> => {
    if (stopRequested) return;
    stopRequested = true;
    process.stdout.write('\nstopping scheduler…\n');
    await scheduler.poller.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  // Idle forever — the poller uses unref'd timers, so we need a
  // long-lived handle to keep the event loop alive. setInterval at
  // a long cadence costs nothing.
  setInterval(() => {}, 60_000);
  return await new Promise<number>(() => {
    /* never resolves; SIGINT calls shutdown() which exits the process */
  });
}
