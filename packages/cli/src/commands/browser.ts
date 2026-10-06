import type { CommandDef } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';
import { argvToSetupOptions, helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { probeSession } from '../setup.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy browser',
  tagline: 'sign-ins of the browser the agent uses in the terminal',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['login <site>', 'open a window to sign in; the browser keeps the sign-in'],
        ['logout <site>', 'forget the sign-in to a site'],
        ['logout --all', 'forget every sign-in'],
        ['sites', 'list the sites with a saved sign-in'],
      ],
    },
  ],
  footer: ['Also in the TUI as /browser. The desktop app signs in inside its own browser pane.'],
});

/** What follows `moxxy browser`, as `/browser` takes it. */
export function browserArgs(argv: ParsedArgv): string {
  return [...argv.positional, ...(argv.flags.all ? ['--all'] : [])].join(' ');
}

/** Run the browser extension's `/browser` with `args`; the exit code. */
export async function runBrowserIn(
  commands: { get(name: string): CommandDef | undefined },
  args: string,
  session: unknown = null,
): Promise<number> {
  const command = commands.get('browser');
  if (!command) {
    printError("the browser extension isn't installed\n  install it with: moxxy extensions install browser");
    return 2;
  }
  const output = await command.handler({ channel: 'cli', sessionId: 'cli' as never, args, session });
  if (output.kind === 'error') {
    printError(output.message);
    return 1;
  }
  if (output.kind === 'text') process.stdout.write(output.text + '\n');
  return 0;
}

export async function runBrowserCommand(argv: ParsedArgv): Promise<number> {
  if (argv.positional.length === 0 || argv.positional[0] === 'help' || helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  // Only the extension's command is needed: no model, no init-time daemons.
  return probeSession(
    argvToSetupOptions(argv, { skipKeyPrompt: true, tolerateNoProvider: true, skipProviderActivation: true }),
    ({ session }) => runBrowserIn(session.commands, browserArgs(argv), session),
  );
}
