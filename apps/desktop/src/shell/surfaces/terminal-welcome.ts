/**
 * What the terminal pane shows above the shell's first prompt: the name and
 * one line saying the shell is shared. Written by the pane, never by the
 * shell, so it costs the agent's commands nothing.
 */

/** MOXXY in half blocks: two rows of the terminal carry four rows of letter. */
export const TERMINAL_WORDMARK: ReadonlyArray<string> = [
  '█▄ ▄█ █▀█ ▀▄▀ ▀▄▀ █▄█',
  '█ ▀ █ █▄█ ▄▀▄ ▄▀▄  █',
];

const DIM = '\u001b[90m';
const RESET = '\u001b[0m';

/** Whose shell it is: the agent's (shared with the person), or one of the person's own tabs. */
export type TerminalOwner = 'agent' | 'own';

const CAPTION: Readonly<Record<TerminalOwner, string>> = {
  agent: 'Terminal shared with the agent',
  own: 'Your terminal in this project',
};

/** The greeting as terminal output: the name plain, its line dim, in the theme's own colours. */
export function terminalWelcome(owner: TerminalOwner = 'agent'): string {
  const caption = `${DIM}${CAPTION[owner]}${RESET}`;
  return ['', ...TERMINAL_WORDMARK, '', caption, '', ''].join('\r\n');
}
