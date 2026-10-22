/**
 * The Agent SDK runs the person's own Claude Code CLI. It can start a native
 * binary or a `cli.js`, but not a Windows npm `.cmd` shim, so that one is
 * swapped for the `cli.js` npm put beside it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CLAUDE_CLI, PATH_FALLBACK_ENV } from '@moxxy/agent-connection-kit';
import { writeFakeCli } from '@moxxy/vitest-preset/fake-cli';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { claudeExecutableForSdk, claudeForSdk } from './executable.js';

describe('the Claude Code CLI the SDK runs', () => {
  it('runs a native or linked CLI as found', () => {
    expect(claudeExecutableForSdk('/Users/me/.local/bin/claude', () => false)).toBe('/Users/me/.local/bin/claude');
    expect(claudeExecutableForSdk('C:\\Users\\me\\.local\\bin\\claude.exe', () => false)).toBe('C:\\Users\\me\\.local\\bin\\claude.exe');
  });

  it('runs the cli.js behind a Windows npm shim', () => {
    const shim = path.win32.join('C:\\Users\\me\\AppData\\Roaming\\npm', 'claude.cmd');
    const cli = path.win32.join('C:\\Users\\me\\AppData\\Roaming\\npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');

    expect(claudeExecutableForSdk(shim, (file) => file === cli, path.win32)).toBe(cli);
  });

  it('refuses a shim it cannot see through, rather than running it through a shell', () => {
    expect(() => claudeExecutableForSdk('C:\\npm\\claude.cmd', () => false, path.win32)).toThrow(/claude\.cmd/);
  });
});

describe('claudeForSdk', () => {
  it('takes a configured path as it is', () => {
    expect(claudeForSdk('/opt/claude/bin/claude')).toBe('/opt/claude/bin/claude');
  });
});

describe('the Claude Code a conversation runs, when the desktop could not read the terminal’s PATH', () => {
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, [PATH_FALLBACK_ENV]: process.env[PATH_FALLBACK_ENV] };
  let home: string | undefined;
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (home) removeDirSync(home);
  });

  it('is the copy the installer put in place, not an old one in a fallback folder', () => {
    home = mkdtempSync(path.join(tmpdir(), 'moxxy-claude-sdk-'));
    const options = { windowsEntry: CLAUDE_CLI.windowsShim.entry };
    const current = writeFakeCli(path.join(home, '.local', 'bin', 'claude'), '', options);
    const old = writeFakeCli(path.join(home, 'homebrew', 'bin', 'claude'), '', options);
    process.env.HOME = process.env.USERPROFILE = home;
    process.env.PATH = process.env[PATH_FALLBACK_ENV] = path.dirname(old);

    expect(claudeForSdk('claude')).toBe(claudeExecutableForSdk(current));
  });
});
