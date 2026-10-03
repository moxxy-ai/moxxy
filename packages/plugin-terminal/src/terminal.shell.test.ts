/**
 * runCommand against a REAL interactive zsh set up the way Oh My Zsh does it:
 * `preexec` prints an OSC title sequence right before the command's own output,
 * so the sentinel line does not start at a newline, and every typed character
 * goes through the `url-quote-magic` widget, so zsh reads typed input slowly.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTerminalProcess, type TerminalProcess } from './pty.js';
import { runCommand } from './terminal.js';

const zsh = spawnSync('zsh', ['-c', 'command -v zsh'], { encoding: 'utf8' });
const zshPath = zsh.status === 0 ? zsh.stdout.trim() : null;

/** Well under the test timeout, so a missed sentinel reads as `timedOut`. */
const COMMAND_TIMEOUT_MS = 3_000;

const TITLE_HOOKS = [
  "preexec() { printf '\\e]2;%s\\a\\e]1;%s\\a' \"$1\" \"${1%% *}\"; }",
  "precmd() { printf '\\e]2;%s\\a' \"$PWD\"; }",
  "PROMPT='%~ %# '",
  'autoload -Uz url-quote-magic',
  'zle -N self-insert url-quote-magic',
  'unset HISTFILE',
].join('\n');

describe.skipIf(zshPath === null)('runCommand in a zsh set up like Oh My Zsh', () => {
  const saved = { SHELL: process.env.SHELL, ZDOTDIR: process.env.ZDOTDIR };
  let dotdir: string;
  let term: TerminalProcess;

  beforeEach(async () => {
    dotdir = mkdtempSync(path.join(os.tmpdir(), 'moxxy-zsh-'));
    writeFileSync(path.join(dotdir, '.zshrc'), `${TITLE_HOOKS}\n`);
    process.env.SHELL = zshPath ?? undefined;
    process.env.ZDOTDIR = dotdir;
    term = await createTerminalProcess(os.tmpdir());
  });

  afterEach(() => {
    term.kill();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dotdir, { recursive: true, force: true });
  });

  it('finishes as soon as the command does instead of waiting out the timeout', async () => {
    const res = await runCommand(term, 'echo hi', '__MOXXY_DONE_zsh_0__', COMMAND_TIMEOUT_MS);

    expect(res.timedOut).toBe(false);
    expect(res.exitCode).toBe(0);
  });

  it('reports the exit code of a failing command', async () => {
    const res = await runCommand(term, 'false', '__MOXXY_DONE_zsh_1__', COMMAND_TIMEOUT_MS);

    expect(res.exitCode).toBe(1);
  });

  it('returns the output as plain text, without the terminal control sequences', async () => {
    const res = await runCommand(term, 'echo hi', '__MOXXY_DONE_zsh_2__', COMMAND_TIMEOUT_MS);

    expect(res.output.split('\n')).toContain('hi');
    expect(res.output).not.toContain('\u001b');
    expect(res.output).not.toContain('\u0007');
    expect(res.output).not.toContain('\r');
  });

  it('runs a long script fed through a heredoc whole, and the shell takes the next command', async () => {
    // Lines wider than the 80-column terminal: typed in, zsh redraws them while
    // more input arrives and loses characters (the heredoc's end line with them).
    const body = Array.from({ length: 60 }, (_, i) => `print('line ${i} ${'x'.repeat(100)}')`).join('\n');
    const script = `python3 - <<'PY'\n${body}\nPY`;

    const res = await runCommand(term, script, '__MOXXY_DONE_zsh_3__', COMMAND_TIMEOUT_MS);
    const next = await runCommand(term, 'echo ok', '__MOXXY_DONE_zsh_4__', COMMAND_TIMEOUT_MS);

    expect(res.timedOut).toBe(false);
    const printed = res.output.split('\n').filter((line) => line.startsWith('line '));
    expect(printed).toEqual(Array.from({ length: 60 }, (_, i) => `line ${i} ${'x'.repeat(100)}`));
    expect(next.output.split('\n')).toContain('ok');
  });

  it('keeps what a script changes in the shell, as if it had been typed', async () => {
    await runCommand(term, `cd /\nexport MOXXY_SEEN=${'y'.repeat(600)}`, '__MOXXY_DONE_zsh_5__', COMMAND_TIMEOUT_MS);
    const res = await runCommand(term, 'pwd; echo ${#MOXXY_SEEN}', '__MOXXY_DONE_zsh_6__', COMMAND_TIMEOUT_MS);

    expect(res.output.split('\n')).toEqual(expect.arrayContaining(['/', '600']));
  });

  it('frees a shell left waiting for the end of an unfinished command', async () => {
    const stuck = await runCommand(term, "cat <<'NEVER'", '__MOXXY_DONE_zsh_7__', 1_000);
    const next = await runCommand(term, 'echo ok', '__MOXXY_DONE_zsh_8__', COMMAND_TIMEOUT_MS);

    expect(stuck.timedOut).toBe(true);
    expect(stuck.output).toContain('waiting for the rest of an unfinished command');
    expect(next.output.split('\n')).toContain('ok');
  });
});
