import { afterEach, describe, expect, it } from 'vitest';
import { claudeEnv } from './agent-session.js';

const KEYS = ['ELECTRON_RUN_AS_NODE', 'NODE_PATH', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'MOXXY_BROWSER_BRIDGE_TOKEN', 'MOXXY_RUNNER_SOCKET', 'MOXXY_HOME'] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('the environment Moxxy gives Claude Code', () => {
  it("leaves out Moxxy's ELECTRON_RUN_AS_NODE and the app's folders on NODE_PATH, which Claude would pass to every program it runs", () => {
    process.env.ELECTRON_RUN_AS_NODE = '1';
    const windows = process.platform === 'win32';
    const theirs = windows ? 'C:\\Users\\me\\node' : '/Users/me/lib/node';
    const app = windows
      ? 'C:\\Program Files\\MoxxyAI Workspaces\\resources\\app.asar.unpacked\\node_modules'
      : '/Applications/MoxxyAI Workspaces.app/Contents/Resources/app.asar.unpacked/node_modules';
    process.env.NODE_PATH = `${theirs}${windows ? ';' : ':'}${app}`;

    const env = claudeEnv();

    expect('ELECTRON_RUN_AS_NODE' in env).toBe(false);
    expect(env.NODE_PATH).toBe(theirs);
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('moxxy');
  });

  it("leaves out Moxxy's own variables but MOXXY_HOME, which Claude needs none of", () => {
    process.env.MOXXY_BROWSER_BRIDGE_TOKEN = 'bridge-secret';
    process.env.MOXXY_RUNNER_SOCKET = '/tmp/desk.sock';
    process.env.MOXXY_HOME = '/tmp/moxxy-home';

    const env = claudeEnv();

    expect(Object.keys(env).filter((key) => key.startsWith('MOXXY_'))).toEqual(['MOXXY_HOME']);
    expect(env.MOXXY_HOME).toBe('/tmp/moxxy-home');
  });

  it('leaves out the markers that make Claude refuse to start inside another Claude Code', () => {
    process.env.CLAUDECODE = '1';
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';

    const env = claudeEnv();

    expect('CLAUDECODE' in env).toBe(false);
    expect('CLAUDE_CODE_ENTRYPOINT' in env).toBe(false);
  });
});
