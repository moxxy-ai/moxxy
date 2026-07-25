import { connect } from 'node:net';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  NativeBrowserBridge,
  nativeBrowserBridgeSocket,
  type NativeBrowserAgentAction,
} from './native-browser-bridge.js';

const bridges: NativeBrowserBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
});

describe('NativeBrowserBridge', () => {
  it('authenticates a workspace-scoped request and forwards the validated action', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'moxxy-native-browser-'));
    const socketPath = nativeBrowserBridgeSocket(root, 'darwin');
    const received: Array<{ workspaceId: string; action: NativeBrowserAgentAction }> = [];
    const bridge = new NativeBrowserBridge({
      socketPath,
      execute: async (workspaceId, action) => {
        received.push({ workspaceId, action });
        return { url: 'https://example.com/' };
      },
    });
    bridges.push(bridge);
    await bridge.start();
    const env = bridge.runnerEnvironment('ws-1');

    const response = await request(socketPath, {
      id: 'request-1',
      token: env.MOXXY_NATIVE_BROWSER_TOKEN,
      workspaceId: 'ws-1',
      action: { kind: 'text', selector: 'main', tabId: 'tab-1' },
    });

    expect(response).toEqual({
      id: 'request-1',
      ok: true,
      result: { url: 'https://example.com/' },
    });
    expect(received).toEqual([
      {
        workspaceId: 'ws-1',
        action: { kind: 'text', selector: 'main', tabId: 'tab-1' },
      },
    ]);
    expect(env).toMatchObject({
      MOXXY_BROWSER_BACKEND: 'native',
      MOXXY_NATIVE_BROWSER_SOCKET: socketPath,
      MOXXY_NATIVE_BROWSER_WORKSPACE_ID: 'ws-1',
    });
    expect(env.MOXXY_NATIVE_BROWSER_TOKEN).toHaveLength(64);
  });

  it('rejects an invalid token and a token replayed for another workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'moxxy-native-browser-'));
    const socketPath = nativeBrowserBridgeSocket(root, 'linux');
    let executed = 0;
    const bridge = new NativeBrowserBridge({
      socketPath,
      execute: async () => {
        executed += 1;
        return null;
      },
    });
    bridges.push(bridge);
    await bridge.start();
    const ws1 = bridge.runnerEnvironment('ws-1');
    bridge.runnerEnvironment('ws-2');

    const invalid = await request(socketPath, {
      id: 'bad-token',
      token: '0'.repeat(64),
      workspaceId: 'ws-1',
      action: { kind: 'url' },
    });
    const replayed = await request(socketPath, {
      id: 'wrong-workspace',
      token: ws1.MOXXY_NATIVE_BROWSER_TOKEN,
      workspaceId: 'ws-2',
      action: { kind: 'url' },
    });

    expect(invalid).toMatchObject({ id: 'bad-token', ok: false });
    expect(replayed).toMatchObject({ id: 'wrong-workspace', ok: false });
    expect(executed).toBe(0);
  });

  it('rejects malformed actions at the socket trust boundary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'moxxy-native-browser-'));
    const socketPath = nativeBrowserBridgeSocket(root, 'darwin');
    let executed = 0;
    const bridge = new NativeBrowserBridge({
      socketPath,
      execute: async () => {
        executed += 1;
        return null;
      },
    });
    bridges.push(bridge);
    await bridge.start();
    const env = bridge.runnerEnvironment('ws-1');

    const response = await request(socketPath, {
      id: 'malformed',
      token: env.MOXXY_NATIVE_BROWSER_TOKEN,
      workspaceId: 'ws-1',
      action: { kind: 'eval', expression: '' },
    });

    expect(response).toMatchObject({ id: 'malformed', ok: false });
    expect(executed).toBe(0);
  });

  it('creates a private socket directory and filesystem socket on POSIX', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'moxxy-native-browser-'));
    const socketPath = nativeBrowserBridgeSocket(root, 'linux');
    const bridge = new NativeBrowserBridge({ socketPath, execute: async () => null });
    bridges.push(bridge);
    await bridge.start();

    const directory = await stat(path.dirname(socketPath));
    const socket = await stat(socketPath);
    expect(directory.mode & 0o777).toBe(0o700);
    expect(socket.mode & 0o777).toBe(0o600);
    await expect(readFile(socketPath)).rejects.toThrow();
  });

  it('uses a named pipe address on Windows', () => {
    expect(nativeBrowserBridgeSocket('C:\\Users\\me\\AppData\\Moxxy', 'win32')).toBe(
      '\\\\.\\pipe\\moxxy-native-browser',
    );
  });

  it('uses a stable short POSIX socket when the profile path exceeds the macOS limit', () => {
    const longProfile = path.join(
      '/Users/example/Library/Application Support',
      'moxxy-desktop-profile-with-a-deliberately-long-name',
    );

    const first = nativeBrowserBridgeSocket(longProfile, 'darwin');
    const second = nativeBrowserBridgeSocket(longProfile, 'darwin');
    const other = nativeBrowserBridgeSocket(`${longProfile}-other`, 'darwin');

    expect(Buffer.byteLength(first, 'utf8')).toBeLessThanOrEqual(103);
    expect(first).toBe(second);
    expect(other).not.toBe(first);
    expect(path.basename(first)).toBe('bridge.sock');
  });
});

function request(socketPath: string, payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
    });
  });
}
