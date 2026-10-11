import { describe, expect, it } from 'vitest';
import { opencodeTarget } from './executable.js';

describe('starting the person OpenCode without a shell', () => {
  it('runs what PATH finds as it is on macOS and Linux', () => {
    expect(opencodeTarget('opencode', { platform: 'darwin', find: () => '/opt/homebrew/bin/opencode' })).toEqual({
      kind: 'direct',
      command: '/opt/homebrew/bin/opencode',
    });
  });

  it('runs opencode.exe as it is on Windows', () => {
    const exe = 'C:\\Users\\me\\scoop\\shims\\opencode.exe';
    expect(opencodeTarget('opencode', { platform: 'win32', find: () => exe })).toEqual({ kind: 'direct', command: exe });
  });

  it('starts the opencode.exe behind the npm .cmd shim on Windows', () => {
    const shim = 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd';
    const exe = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe';
    expect(opencodeTarget('opencode', { platform: 'win32', find: () => shim, exists: (file) => file === exe })).toEqual({
      kind: 'direct',
      command: exe,
    });
  });

  it('says what to do when the shim leads nowhere', () => {
    expect(() => opencodeTarget('opencode', { platform: 'win32', find: () => 'C:\\npm\\opencode.cmd', exists: () => false })).toThrow(
      /reinstall OpenCode/,
    );
  });

  it('says how to install OpenCode when it is not found', () => {
    expect(() => opencodeTarget('opencode', { find: () => null })).toThrow(/OPENCODE_EXECUTABLE/);
  });
});
