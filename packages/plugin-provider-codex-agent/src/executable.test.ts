import { describe, expect, it } from 'vitest';
import { codexTarget } from './executable.js';

describe('starting the person Codex without a shell', () => {
  it('runs Codex from PATH as it is on macOS and Linux', () => {
    expect(codexTarget('codex', { platform: 'darwin', find: () => '/Users/me/.local/bin/codex' })).toEqual({
      kind: 'direct',
      command: '/Users/me/.local/bin/codex',
    });
  });

  it('starts the codex.exe behind a Windows npm shim itself, so no console window opens for it', () => {
    const codexPackage = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex';
    const exe = `${codexPackage}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
    const target = codexTarget('codex', {
      platform: 'win32',
      arch: 'x64',
      find: () => 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd',
      exists: (file) => file === exe,
    });
    expect(target).toEqual({
      kind: 'direct',
      command: exe,
      env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: codexPackage },
    });
  });

  it('runs the codex.js behind a Windows npm shim with Node when its codex.exe is missing', () => {
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
