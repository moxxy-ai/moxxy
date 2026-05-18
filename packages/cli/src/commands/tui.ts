import type { ParsedArgv } from '../argv.js';
import { runTuiWithBootstrap } from './run-tui.js';

/**
 * `moxxy tui` entry point. The actual implementation lives in
 * `run-tui.ts` so the bin dispatcher AND `moxxy channels tui` (via
 * `runChannelByName`) hit the exact same code path — neither route
 * should pre-boot the session ahead of Ink mounting.
 */
export async function runTuiCommand(argv: ParsedArgv): Promise<number> {
  return runTuiWithBootstrap(argv);
}
