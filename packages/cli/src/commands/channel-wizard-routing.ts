import type { ChannelDef } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';
import { hasBoolFlag } from '../argv-helpers.js';

/** Internal flag marking a wizard → channel hand-off (never typed by users). */
const SKIP_WIZARD_FLAG = '__skipWizard';

/**
 * Whether `moxxy <channel>` should open the channel's interactive setup instead
 * of starting it. Bypassed for non-TTY runs (cron / systemd / piped),
 * `--no-wizard`, `--standalone`, and a wizard hand-off — the last one is what
 * stops "Start the bot" from re-opening the same menu forever. (The caller
 * additionally skips the wizard when a runner is already up; that check is
 * async and deliberately evaluated last.)
 */
export function wantsInteractiveSetup(
  def: Pick<ChannelDef, 'interactiveCommand'>,
  argv: ParsedArgv,
  isTTY: boolean,
): boolean {
  return (
    !!def.interactiveCommand &&
    isTTY &&
    !hasBoolFlag(argv, 'no-wizard') &&
    !hasBoolFlag(argv, SKIP_WIZARD_FLAG) &&
    !hasBoolFlag(argv, 'standalone')
  );
}

/** The argv a wizard's `startChannel` hand-off re-enters `runChannelByName` with. */
export function wizardHandoffArgv(
  argv: ParsedArgv,
  extraFlags: Record<string, string | boolean>,
): ParsedArgv {
  return {
    command: argv.command,
    flags: { ...argv.flags, ...extraFlags, [SKIP_WIZARD_FLAG]: true },
    positional: [],
  };
}
