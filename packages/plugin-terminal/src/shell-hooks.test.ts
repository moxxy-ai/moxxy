import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ShellMarks, installShellHooks, shellMark } from './shell-hooks.js';

describe('ShellMarks', () => {
  it('reads every report in a chunk: a command started, then the prompt back with its exit code', () => {
    const marks = new ShellMarks('k1');
    const stream = `~ % ls\n${shellMark('k1', { commands: 3, exitCode: null })}a.txt\n${shellMark('k1', { commands: 3, exitCode: 127 })}`;

    expect(marks.read(stream)).toEqual([
      { commands: 3, exitCode: null },
      { commands: 3, exitCode: 127 },
    ]);
  });

  it('reads a report split across two chunks, once', () => {
    const marks = new ShellMarks('k1');
    const mark = shellMark('k1', { commands: 1, exitCode: 42 });

    expect(marks.read(mark.slice(0, 9))).toEqual([]);
    expect(marks.read(mark.slice(9))).toEqual([{ commands: 1, exitCode: 42 }]);
    expect(marks.read('more output')).toEqual([]);
  });

  it('ignores a report made with another key, so printed text cannot end a command', () => {
    const marks = new ShellMarks('k1');

    expect(marks.read(shellMark('guess', { commands: 9, exitCode: 0 }))).toEqual([]);
  });
});

describe('installShellHooks', () => {
  it('leaves a shell it has no start files for alone', () => {
    expect(installShellHooks('/usr/bin/fish', {})).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('starts zsh from its own start files, which run the user\'s', () => {
    const hooks = installShellHooks('/bin/zsh', { ZDOTDIR: '/home/me/dots' });
    if (!hooks) throw new Error('expected hooks for zsh');
    try {
      const dir = hooks.env['ZDOTDIR'] ?? '';
      expect(dir).not.toBe('/home/me/dots');
      expect(readFileSync(path.join(dir, '.zshenv'), 'utf8')).toContain("'/home/me/dots'");
      expect(readFileSync(path.join(dir, '.zshrc'), 'utf8')).toContain(hooks.key);
      expect(hooks.args).toEqual([]);
    } finally {
      hooks.remove();
    }
    expect(existsSync(hooks.env['ZDOTDIR'] ?? '')).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('starts bash from an init file, which runs the user\'s', () => {
    const hooks = installShellHooks('/bin/bash', {});
    if (!hooks) throw new Error('expected hooks for bash');
    try {
      expect(hooks.args[0]).toBe('--init-file');
      const init = readFileSync(hooks.args[1] ?? '', 'utf8');
      expect(init).toContain('.bashrc');
      expect(init).toContain(hooks.key);
    } finally {
      hooks.remove();
    }
  });
});
