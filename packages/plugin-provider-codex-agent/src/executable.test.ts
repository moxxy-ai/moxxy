import { describe, expect, it } from 'vitest';
import { codexTarget } from './executable.js';

describe('starting the person Codex without a shell', () => {
  it('runs Codex from PATH as it is on macOS and Linux', () => {
    expect(codexTarget('codex', { platform: 'darwin', find: () => '/Users/me/.local/bin/codex' })).toEqual({
      kind: 'direct',
      command: '/Users/me/.local/bin/codex',
    });
  });

  it('runs the codex.js behind a Windows npm shim with Node', () => {
    const target = codexTarget('codex', {
      platform: 'win32',
      find: () => 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd',
      exists: (file) => file === 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      electron: true,
    });
    expect(target).toEqual({
      kind: 'node',
      command: process.execPath,
      entry: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it('runs the standalone codex.exe on Windows as it is', () => {
    expect(codexTarget('codex', { platform: 'win32', find: () => 'C:\\Users\\me\\.codex\\bin\\codex.exe' })).toEqual({
      kind: 'direct',
      command: 'C:\\Users\\me\\.codex\\bin\\codex.exe',
    });
  });

  it('says so when Codex is not installed', () => {
    expect(() => codexTarget('codex', { find: () => null })).toThrow(/Codex CLI not found/);
  });
});
