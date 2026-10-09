/**
 * Start files that make zsh and bash report each command they start and every
 * return to their prompt, in a control sequence a terminal does not draw. The
 * `terminal` tool waits for that report. It used to type a `printf` after the
 * command: typed-ahead input is read by whatever is running, so an installer
 * asking questions swallowed it and the call waited out its timeout.
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export interface ShellHooks {
  /** Unpredictable, so text a command prints cannot pass for a report. */
  readonly key: string;
  readonly args: string[];
  readonly env: NodeJS.ProcessEnv;
  /** Deletes the start files; the running shell has read them already. */
  remove(): void;
}

/** An operating-system command no terminal knows, so none draws it. */
const OSC = '\u001b]7717;moxxy;';
const END = '\u0007';

/**
 * One report: how many commands the shell has started, and, when it is back at
 * its prompt, the last one's exit code (null while that command still runs).
 */
export interface ShellReport {
  readonly commands: number;
  readonly exitCode: number | null;
}

/** What a hooked shell prints: before a command with no exit code, before each prompt with one. */
export function shellMark(key: string, report: ShellReport): string {
  return `${OSC}${key};${report.commands};${report.exitCode ?? ''}${END}`;
}

/** Finds the shell's reports in a stream that arrives in arbitrary chunks. */
export class ShellMarks {
  private readonly mark: RegExp;
  private readonly longest: number;
  private carry = '';

  constructor(key: string) {
    // The key is hex, so nothing in it needs escaping.
    this.mark = new RegExp(`\\u001b\\]7717;moxxy;${key};(\\d+);(\\d*)\\u0007`, 'gu');
    this.longest = shellMark(key, { commands: 0, exitCode: 0 }).length + 32;
  }

  /** The reports in `chunk`, counting one begun in an earlier chunk. */
  read(chunk: string): ShellReport[] {
    const text = this.carry + chunk;
    const reports: ShellReport[] = [];
    let end = 0;
    for (const match of text.matchAll(this.mark)) {
      reports.push({ commands: Number(match[1]), exitCode: match[2] ? Number(match[2]) : null });
      end = match.index + match[0].length;
    }
    this.carry = text.slice(Math.max(end, text.length - this.longest));
    return reports;
  }
}

const quoted = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** printf's own escapes, so the start files stay plain text. */
const print = (key: string): string => `builtin printf '\\033]7717;moxxy;${key};%s;%s\\007'`;

function zshFiles(key: string, userDir: string | undefined): Record<string, string> {
  const restore = userDir === undefined ? 'unset ZDOTDIR' : `ZDOTDIR=${quoted(userDir)}`;
  return {
    '.zshenv': [
      '__moxxy_start=$ZDOTDIR',
      restore,
      '[[ -f ${ZDOTDIR:-$HOME}/.zshenv ]] && . ${ZDOTDIR:-$HOME}/.zshenv',
      // The user's own file may have moved ZDOTDIR: that is where the rest lives.
      '__moxxy_user=${ZDOTDIR-}',
      'ZDOTDIR=$__moxxy_start',
    ].join('\n'),
    '.zshrc': [
      // /etc/zshrc pointed the history at these start files; it belongs to the user.
      '[[ $HISTFILE == $__moxxy_start/* ]] && HISTFILE=${__moxxy_user:-$HOME}/${HISTFILE:t}',
      'if [[ -n $__moxxy_user ]]; then ZDOTDIR=$__moxxy_user; else unset ZDOTDIR; fi',
      'unset __moxxy_start __moxxy_user',
      '[[ -f ${ZDOTDIR:-$HOME}/.zshrc ]] && . ${ZDOTDIR:-$HOME}/.zshrc',
      'typeset -gi __moxxy_commands=0',
      `__moxxy_command() { (( __moxxy_commands += 1 )); ${print(key)} $__moxxy_commands '' }`,
      `__moxxy_prompt() { ${print(key)} $__moxxy_commands "$?" }`,
      'preexec_functions+=(__moxxy_command)',
      'precmd_functions=(__moxxy_prompt $precmd_functions)',
    ].join('\n'),
  };
}

/**
 * bash has no hook before a command, so the reports ride on its prompt strings,
 * where `\#` is the number of the command about to be read: PS1 carries the
 * prompt's, PS0 (bash 4.4 and later, ignored before) the command's.
 */
function bashInit(key: string): string {
  const mark = (commands: string, exitCode: string): string => `\\033]7717;moxxy;${key};${commands};${exitCode}\\007`;
  return [
    '[ -f ~/.bashrc ] && . ~/.bashrc',
    '__moxxy_code=0',
    // Returns the code it read, so the user's own prompt command still sees it.
    '__moxxy_prompt() { __moxxy_code=$?; return $__moxxy_code; }',
    // Put back each time: a prompt command that rebuilds PS1 drops it.
    `__moxxy_ps1() { case "$PS1" in *"7717;moxxy;${key}"*) ;; *) PS1='\\[${mark('$((\\#-1))', '${__moxxy_code}')}\\]'"$PS1" ;; esac; }`,
    `PS0='${mark('\\#', '')}'"\${PS0-}"`,
    "__moxxy_nl=$'\\n'",
    'case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in',
    '  "declare -a"*) PROMPT_COMMAND=(__moxxy_prompt "${PROMPT_COMMAND[@]}" __moxxy_ps1) ;;',
    // Joined by newlines: the user's own may end in a `;`.
    '  *) PROMPT_COMMAND="__moxxy_prompt${PROMPT_COMMAND:+$__moxxy_nl$PROMPT_COMMAND}${__moxxy_nl}__moxxy_ps1" ;;',
    'esac',
  ].join('\n');
}

/** The start files for `shell`, or null for a shell there are none for (cmd, PowerShell, fish). */
export function installShellHooks(shell: string, env: NodeJS.ProcessEnv): ShellHooks | null {
  if (process.platform === 'win32') return null;
  const name = basename(shell);
  if (name !== 'zsh' && name !== 'bash') return null;
  const key = randomBytes(8).toString('hex');
  const dir = mkdtempSync(join(tmpdir(), 'moxxy-shell-'));
  const remove = (): void => rmSync(dir, { recursive: true, force: true });
  if (name === 'zsh') {
    for (const [file, text] of Object.entries(zshFiles(key, env['ZDOTDIR']))) {
      writeFileSync(join(dir, file), `${text}\n`, { mode: 0o600 });
    }
    return { key, args: [], env: { ...env, ZDOTDIR: dir }, remove };
  }
  const init = join(dir, 'init.bash');
  writeFileSync(init, `${bashInit(key)}\n`, { mode: 0o600 });
  return { key, args: ['--init-file', init], env, remove };
}
