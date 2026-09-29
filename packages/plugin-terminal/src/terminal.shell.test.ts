/**
 * runCommand against a REAL interactive zsh whose hooks write the window title
 * the way Oh My Zsh does: `preexec` prints an OSC title sequence right before
 * the command's own output, so the sentinel line does not start at a newline.
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
  'unset HISTFILE',
].join('\n');

describe.skipIf(zshPath === null)('runCommand in a zsh that sets the window title', () => {
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
});
