import { afterEach, describe, expect, it } from 'vitest';
import { claudeEnv } from './agent-session.js';

const KEYS = ['ELECTRON_RUN_AS_NODE', 'NODE_PATH', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'] as const;
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
    process.env.NODE_PATH = '/Users/me/lib/node:/Applications/MoxxyAI Workspaces.app/Contents/Resources/app.asar.unpacked/node_modules';

    const env = claudeEnv();

    expect('ELECTRON_RUN_AS_NODE' in env).toBe(false);
    expect(env.NODE_PATH).toBe(process.platform === 'win32' ? process.env.NODE_PATH : '/Users/me/lib/node');
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('moxxy');
  });

  it('leaves out the markers that make Claude refuse to start inside another Claude Code', () => {
    process.env.CLAUDECODE = '1';
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';

    const env = claudeEnv();

    expect('CLAUDECODE' in env).toBe(false);
    expect('CLAUDE_CODE_ENTRYPOINT' in env).toBe(false);
  });
});
