import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyHelperArtifact } from '../helper/artifact.js';
import { HelperTransport } from '../helper/transport.js';
import { CONTRACT_PROTOCOL_VERSION, appStateSchema, listAppsResultSchema, resolveAppsResultSchema, statusResultSchema } from '../backend/rpc.js';
import { macosHelperPath } from './profile.js';

// Talks to the real universal helper built by native/macos/build.sh; other hosts and unbuilt trees skip.
const built = process.platform === 'darwin' && existsSync(macosHelperPath);
const signal = () => new AbortController().signal;
const start = () => new HelperTransport(macosHelperPath, ['--parent', String(process.pid)], { protocolVersion: CONTRACT_PROTOCOL_VERSION });

describe.skipIf(!built)('macOS native helper', () => {
  it('is a verified universal artifact for the shared protocol', async () => {
    await expect(verifyHelperArtifact(macosHelperPath, CONTRACT_PROTOCOL_VERSION)).resolves.toBeUndefined();
  });

  it('reports its readiness and the permissions it still needs', async () => {
    const transport = start();
    try {
      const status = statusResultSchema.parse(await transport.request('status', {}, signal()));
      expect(status.ready).toBe(status.permissions.accessibility && status.permissions.screenRecording);
    } finally { await transport.close(); }
  });

  it('refuses an unknown method with a code and keeps serving', async () => {
    const transport = start();
    try {
      await expect(transport.request('teleport', {}, signal())).rejects.toMatchObject({ code: 'unsupported_action' });
      await expect(transport.request('status', {}, signal())).resolves.toBeTypeOf('object');
    } finally { await transport.close(); }
  });

  it('lists and resolves installed and running apps in the contract shape', async () => {
    const transport = start();
    try {
      const listed = listAppsResultSchema.parse(await transport.request('list_apps', { query: 'finder', limit: 5 }, signal()));
      expect(listed.apps[0]).toEqual({ id: 'com.apple.finder', name: 'Finder', running: true });
      const resolved = resolveAppsResultSchema.parse(await transport.request('resolve_apps', { names: ['Calculator', 'No Such App 1234'] }, signal()));
      expect(resolved.apps[0]).toMatchObject({ request: 'Calculator', status: 'resolved', name: 'Calculator' });
      expect(resolved.apps[1]).toEqual({ request: 'No Such App 1234', status: 'not_found' });
    } finally { await transport.close(); }
  });

  it('exits as soon as its input closes', async () => {
    const transport = start();
    await transport.request('status', {}, signal());
    const started = performance.now();
    await transport.close();
    expect(performance.now() - started).toBeLessThan(450);
  });

  it('exits when the process it serves dies', async () => {
    const parent = spawn('/bin/sleep', ['30']);
    const helper = spawn(macosHelperPath, ['--parent', String(parent.pid)], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      const exited = once(helper, 'exit');
      parent.kill('SIGKILL');
      const [code] = await Promise.race([exited, timeout(2000)]);
      expect(code).toBe(0);
    } finally { stop(helper); stop(parent); }
  });

  it('refuses to start without the process it serves', async () => {
    const helper = spawn(macosHelperPath, [], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      const [code] = await Promise.race([once(helper, 'exit'), timeout(2000)]);
      expect(code).toBe(64);
    } finally { stop(helper); }
  });
});

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`no exit within ${ms} ms`)), ms).unref());
}

function stop(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

// The test-only AppKit app from native/macos/build-fixture.sh, registered with LaunchServices.
const FIXTURE = 'ai.moxxy.computer-fixture';
const fixtureBuilt = built && existsSync(new URL('../../native/macos/.build/fixture/MoxxyComputerFixture.app', import.meta.url));
const quitFixture = async () => {
  spawnSync('pkill', ['-x', 'MoxxyComputerFixture']);
  for (let attempt = 0; attempt < 50 && spawnSync('pgrep', ['-x', 'MoxxyComputerFixture']).status === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe.skipIf(!fixtureBuilt)('macOS app state', () => {
  beforeAll(quitFixture);
  afterAll(quitFixture);

  it('launches the app in the background and returns its indexed accessibility tree', async () => {
    const transport = start();
    try {
      const state = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
      expect(state.tree).toMatchObject({ app: 'Moxxy Computer Fixture', window: 'Moxxy Fixture' });
      const byKey = new Map(state.tree.elements.map((element) => [element.key.split('/').at(-1), element]));
      expect(byKey.get('text field:name')).toMatchObject({ value: 'hello', description: 'placeholder: Name' });
      expect(byKey.get('button:press')).toMatchObject({ role: 'button', title: 'Press' });
      expect(byKey.get('checkbox:remember')).toMatchObject({ states: ['checked'] });
      expect(byKey.get('button:disabled')?.states).toContain('disabled');
      expect(byKey.get('text:status')).toMatchObject({ title: 'Ready' });
      const secret = [...byKey.values()].find((element) => element.secure);
      expect(secret?.value).toBeUndefined();
      expect(JSON.stringify(state)).not.toContain('hunter2');
      expect(state.tree.elements.some((element) => element.role === 'group')).toBe(false);
    } finally { await transport.close(); }
  });

  it('keeps every element index across observations', async () => {
    const transport = start();
    try {
      const first = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
      const second = appStateSchema.parse(await transport.request('get_app_state', { app: FIXTURE, screenshot: false }, signal()));
      const indices = (state: typeof first) => Object.fromEntries(state.tree.elements.map((element) => [element.key, element.index]));
      expect(indices(second)).toEqual(indices(first));
    } finally { await transport.close(); }
  });

  it('refuses an app it cannot find', async () => {
    const transport = start();
    try {
      await expect(transport.request('get_app_state', { app: 'ai.moxxy.no-such-app', screenshot: false }, signal())).rejects.toMatchObject({ code: 'app_not_found' });
    } finally { await transport.close(); }
  });
});
