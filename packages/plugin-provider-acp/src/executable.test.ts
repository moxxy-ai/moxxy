import { describe, expect, it } from 'vitest';
import { opencodeAcpLaunch, opencodeServesApiBesideAcp, opencodeTarget } from './executable.js';

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

  it('starts the opencode.exe behind the npm shim of OpenCode 2, which npm installs as @opencode/cli', () => {
    const shim = 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd';
    const exe = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe';
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

describe('the OpenCode Moxxy starts for a conversation', () => {
  it('serves its HTTP API on a port Moxxy picked, behind a password only Moxxy knows, with background subagents on', () => {
    const launch = opencodeAcpLaunch({ server: { port: 4321, password: 'secret' }, inherited: {} });

    expect(launch.args).toEqual(['acp', '--port', '4321', '--hostname', '127.0.0.1']);
    expect(launch.env).toEqual({
      OPENCODE_SERVER_USERNAME: 'opencode',
      OPENCODE_SERVER_PASSWORD: 'secret',
      OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'true',
    });
    expect(launch.api).toEqual({ url: 'http://127.0.0.1:4321', authorization: `Basic ${Buffer.from('opencode:secret').toString('base64')}` });
  });

  it('keeps background subagents off when the person turned them off', () => {
    const launch = opencodeAcpLaunch({ server: { port: 4321, password: 'secret' }, inherited: { OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'false' } });

    expect(launch.env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBe('false');
  });

  it('adds its own settings to those of the restart that asks before changes', () => {
    const launch = opencodeAcpLaunch({ server: { port: 1, password: 'p' }, inherited: {}, env: { OPENCODE_CONFIG_CONTENT: '{}' } });

    expect(launch.env).toMatchObject({ OPENCODE_CONFIG_CONTENT: '{}', OPENCODE_SERVER_PASSWORD: 'p' });
  });

  it('starts OpenCode 2 with `acp` alone: it runs a private server and takes no port, so Moxxy has no API to read', () => {
    const launch = opencodeAcpLaunch({ inherited: {} });

    expect(launch.args).toEqual(['acp']);
    expect(launch.env).toEqual({ OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'true' });
    expect(launch.api).toBeUndefined();
  });
});

describe('which OpenCode serves its HTTP API beside ACP', () => {
  it('is OpenCode 1, which takes --port and --hostname for it', () => {
    expect(opencodeServesApiBesideAcp('1.19.4')).toBe(true);
  });

  it('is not OpenCode 2, nor one whose version could not be read, since `acp` alone starts on both', () => {
    expect(opencodeServesApiBesideAcp('2.0.22')).toBe(false);
    expect(opencodeServesApiBesideAcp(null)).toBe(false);
  });
});
