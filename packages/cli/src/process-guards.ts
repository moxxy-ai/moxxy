import { colors } from './colors.js';
import { formatErrorForCli } from './error-formatter.js';

/**
 * Last-resort process-level guards for the long-lived CLI entry point
 * (`moxxy serve`, the TUI, channel daemons — everything routes through
 * `bin.ts`). Per-boundary validation (zod at the channels' trust
 * boundaries) is the real defense; these only stop a single escaped
 * error from silently taking down the runner and every attached client.
 *
 * - `unhandledRejection`: log and keep the process alive — one stray
 *   background promise must not kill a daemon serving other channels.
 * - `uncaughtException`: state is unknowable, so per Node best practice
 *   we log, flush stderr, and exit 1 (launchd/systemd restart the unit).
 */
export function installProcessGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(
      colors.red('[moxxy] unhandled promise rejection (process kept alive):') +
        '\n' +
        formatErrorForCli(reason, { debug: debugEnabled() }) +
        '\n',
    );
  });

  process.on('uncaughtException', (err) => {
    process.exitCode = 1;
    const msg =
      colors.red('[moxxy] uncaught exception — exiting:') +
      '\n' +
      formatErrorForCli(err, { debug: debugEnabled() }) +
      '\n';
    // Exit once the write has flushed; the timer is a backstop in case
    // stderr is wedged. Deliberately NOT unref'd — it guarantees exit.
    const backstop = setTimeout(() => process.exit(1), 250);
    process.stderr.write(msg, () => {
      clearTimeout(backstop);
      process.exit(1);
    });
  });
}

let guardsInstalled = false;

function debugEnabled(): boolean {
  const v = process.env.MOXXY_DEBUG;
  return v === '1' || v === 'true';
}
