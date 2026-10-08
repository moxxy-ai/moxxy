/**
 * What the terminal pane shows above the shell's first prompt: the Moxxy mark
 * and one line saying the shell is shared. Written by the pane, never by the
 * shell, so it costs the agent's commands nothing.
 */

/** The TUI's compact mark (`packages/plugin-cli/src/logo-data.ts`), without its left margin. */
export const TERMINAL_MARK: ReadonlyArray<string> = [
  '          -%@@@@',
  '   :*%@@+=%@@@+%@@@@@@@%*:',
  '   @@%=%@@@= :-------:*@%=@@',
  '   @@@@*              +@@@@%+',
  '=++@@@@*              ++=@@@@*',
  ' *@@@@=+              *@@@@++=',
  '  -%@@@@-             *@@@@',
  '   @@+=%*:-------: =@@@%=%@@',
  '    :*%@@@@@@@%+@@@@%=+@@%*:',
  '           @@@@@@%-',
];

const DIM = '\u001b[90m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

/** The greeting as terminal output: the mark dim, the name plain, in the theme's own colours. */
export function terminalWelcome(): string {
  const mark = TERMINAL_MARK.map((row) => `${DIM}${row}${RESET}`);
  const caption = `${BOLD}Moxxy${RESET} ${DIM}terminal, shared with the agent${RESET}`;
  return ['', ...mark, '', caption, '', ''].join('\r\n');
}
