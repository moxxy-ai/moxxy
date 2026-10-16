/**
 * The Agent SDK runs the person's own Claude Code CLI. It can start a native
 * binary or a `cli.js`, but not a Windows npm `.cmd` shim, so that one is
 * swapped for the `cli.js` npm put beside it.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { claudeExecutableForSdk } from './executable.js';

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
