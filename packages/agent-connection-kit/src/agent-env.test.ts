import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { moxxyOwnVariables, moxxyRuntimeVariables } from './agent-env.js';

const APP = '/Applications/MoxxyAI Workspaces.app/Contents/Resources';

describe("the settings of Moxxy's own process an agent does not inherit", () => {
  it('leave out ELECTRON_RUN_AS_NODE, which turns every Electron app the agent opens (VS Code, Slack) into plain Node', () => {
    expect(moxxyRuntimeVariables({ ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin' })).toEqual({ ELECTRON_RUN_AS_NODE: undefined });
  });

  it("leave out the app's module folders Moxxy put on NODE_PATH, which every node the agent runs would search", () => {
    const nodePath = [`${APP}/app.asar/node_modules`, `${APP}/app.asar.unpacked/node_modules`].join(':');

    expect(moxxyRuntimeVariables({ NODE_PATH: nodePath }, 'darwin')).toEqual({ NODE_PATH: undefined });
  });

  it('keep the folders the person put on NODE_PATH', () => {
    const nodePath = ['/Users/me/lib/node', `${APP}/app.asar/node_modules`, '/opt/node'].join(':');

    expect(moxxyRuntimeVariables({ NODE_PATH: nodePath }, 'darwin')).toEqual({ NODE_PATH: '/Users/me/lib/node:/opt/node' });
  });

  it("read Windows' NODE_PATH, split on ; and with backslashes", () => {
    const app = 'C:\\Users\\me\\AppData\\Local\\Programs\\MoxxyAI Workspaces\\resources';
    const nodePath = [`C:\\Users\\me\\node`, `${app}\\app.asar\\node_modules`, `${app}\\app.asar.unpacked\\node_modules`].join(';');

    expect(moxxyRuntimeVariables({ NODE_PATH: nodePath }, 'win32')).toEqual({ NODE_PATH: 'C:\\Users\\me\\node' });
  });

  it('change nothing when Moxxy added nothing', () => {
    expect(moxxyRuntimeVariables({ NODE_PATH: '/Users/me/lib/node', PATH: '/usr/bin' }, 'darwin')).toEqual({});
  });

  it('are gone from what a started process really gets, while the rest stays', async () => {
    const inherited = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: `${APP}/app.asar/node_modules` };
    const seen = await new Promise<Record<string, string>>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
        env: { ...inherited, ...moxxyRuntimeVariables(inherited) },
      });
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      child.once('error', reject);
      child.once('close', () => resolve(JSON.parse(out) as Record<string, string>));
    });

    expect(seen.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(seen.NODE_PATH).toBeUndefined();
    expect(seen.PATH).toBe(process.env.PATH);
  });
});

describe("the variables of Moxxy an agent does not inherit", () => {
  it('leave out every MOXXY_* but MOXXY_HOME: the browser bridge token is a secret, and the runner address makes a `moxxy` the agent runs join the conversation', () => {
    const inherited = {
      MOXXY_HOME: '/tmp/moxxy-home',
      MOXXY_BROWSER_BRIDGE_TOKEN: 'bridge-secret',
      MOXXY_RUNNER_SOCKET: '/tmp/desk.sock',
      MOXXY_SESSION_ID: 'desk-1',
      ELECTRON_RUN_AS_NODE: '1',
      PATH: '/usr/bin',
    };

    expect(moxxyOwnVariables(inherited)).toEqual({
      MOXXY_BROWSER_BRIDGE_TOKEN: undefined,
      MOXXY_RUNNER_SOCKET: undefined,
      MOXXY_SESSION_ID: undefined,
      ELECTRON_RUN_AS_NODE: undefined,
    });
  });
});
