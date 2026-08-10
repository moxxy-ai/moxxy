import type { ParsedArgv } from '../argv.js';
import { helpRequested } from '../argv-helpers.js';
import { runTuiWithBootstrap } from './run-tui.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy tui',
  tagline: 'open the terminal workspace',
  sections: [
    {
      title: 'USAGE',
      rows: [
        ['moxxy tui', 'attach to the local runner when one is available'],
        ['--standalone', 'start an isolated local run instead of attaching'],
        ['--model <id>', 'use a different model for this run'],
      ],
    },
  ],
  footer: ['Running `moxxy` with no command opens the same everyday workspace.'],
});

/**
 * `moxxy tui` entry point. The actual implementation lives in
 * `run-tui.ts` so the bin dispatcher AND `moxxy channels tui` (via
 * `runChannelByName`) hit the exact same code path — neither route
 * should pre-boot the session ahead of Ink mounting.
 */
export async function runTuiCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  return runTuiWithBootstrap(argv);
}
