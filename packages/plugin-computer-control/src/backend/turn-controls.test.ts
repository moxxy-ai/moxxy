import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComputerControlSnapshot } from '@moxxy/sdk';
import { expect, it } from 'vitest';
import { TAKEOVER_PROTOCOL_VERSION } from '../helper/protocol.js';
import { HelperTransport } from '../helper/transport.js';
import { CONTRACT_PROTOCOL_VERSION } from './rpc.js';
import { TurnControls } from './turn-controls.js';

const OLDER = TAKEOVER_PROTOCOL_VERSION - 1;

/** A helper that writes every line it receives to a file, so a test can read what the host sent it. */
function recordingHelper(version = CONTRACT_PROTOCOL_VERSION) {
  const file = join(mkdtempSync(join(tmpdir(), 'moxxy-controls-')), 'stdin');
  const transport = new HelperTransport(process.execPath, ['-e', `process.stdin.on('data', (d) => require('fs').appendFileSync(${JSON.stringify(file)}, d))`], { protocolVersion: version });
  const sent = () => { try { return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown); } catch { return []; } };
  return { transport, sent };
}
const until = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 20)); };

it('distinguishes the independent panel Stop from a crashed worker', async () => {
  const controls = new TurnControls();
  const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.once("data",()=>process.exit(20))'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  try {
    controls.attach('session', 'turn', transport);
    await expect(transport.request('status', {}, new AbortController().signal)).rejects.toThrow();
    expect((await controls.forSession('session').snapshot())[0]?.state).toBe('stopped');
    await expect(controls.forSession('session').control({sessionId:'session',turnId:'turn',command:'resume'})).rejects.toThrow(/stopped/);
  } finally { await transport.close(); }
});

it('routes human control to the exact live turn and retains a stopped tombstone', async () => {
  const controls = new TurnControls();
  const first = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  const second = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  try {
    controls.attach('a', 'one', first);
    controls.attach('b', 'one', second);
    const service = controls.forSession('a');
    await expect(service.control({ sessionId: 'b', turnId: 'one', command: 'stop' })).rejects.toThrow(/session/);
    await expect(service.control({ sessionId: 'a', turnId: 'missing', command: 'resume' })).rejects.toThrow(/turn/);
    expect(second.closed).toBe(false);
    await service.control({ sessionId: 'a', turnId: 'one', command: 'stop' });
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(await service.snapshot()).toEqual([{sessionId:'a',turnId:'one',state:'stopped',windowId:null}]);
    await expect(service.control({ sessionId: 'a', turnId: 'one', command: 'resume' })).rejects.toThrow(/stopped/);
    controls.update('a', 'one', 'foreground', 'window');
    expect((await service.snapshot())[0]?.state).toBe('stopped');
    controls.detach('a', 'one');
    expect(await service.snapshot()).toEqual([]);
  } finally { await Promise.all([first.close(), second.close()]); }
});

it('tracks native waiting without exposing mutable state to consumers', async () => {
  const controls = new TurnControls();
  const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  try {
    controls.attach('session', 'turn', transport);
    controls.update('session', 'turn', 'waiting_for_focus', 'window');
    const service = controls.forSession('session');
    const snapshots = await service.snapshot();
    expect(snapshots[0]?.state).toBe('waiting_for_focus');
    if (snapshots[0]) snapshots[0].state = 'stopped';
    expect((await service.snapshot())[0]?.state).toBe('waiting_for_focus');
    await service.control({sessionId:'session',turnId:'turn',command:'pause'});
    controls.activity('session', 'turn', 'idle');
    expect((await service.snapshot())[0]?.state).toBe('paused_by_user');
    await service.control({sessionId:'session',turnId:'turn',command:'resume'});
    expect((await service.snapshot())[0]?.state).toBe('recovering');
    await transport.close();
    expect((await service.snapshot())[0]?.state).toBe('failed');
  } finally { await transport.close(); }
});

it('shows the agent cursor and its target to every surface until Computer Use stops', async () => {
  const controls = new TurnControls();
  const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  try {
    controls.attach('session', 'turn', transport);
    const service = controls.forSession('session');
    expect((await service.snapshot())[0]).not.toHaveProperty('cursor');
    controls.target('session', 'turn', { app: 'TextEdit', window: 'Untitled' });
    for (const phase of ['moving', 'executing', 'delivered'] as const) {
      controls.cursor('session', 'turn', { phase, x: 0.5, y: 0.25 });
      expect((await service.snapshot())[0]).toMatchObject({ cursor: { phase, x: 0.5, y: 0.25 }, target: { app: 'TextEdit', window: 'Untitled' } });
    }
    controls.cursor('session', 'turn', null);
    expect((await service.snapshot())[0]).not.toHaveProperty('cursor');
    controls.cursor('session', 'turn', { phase: 'idle', x: 0, y: 1 });
    await service.control({ sessionId: 'session', turnId: 'turn', command: 'stop' });
    const stopped = (await service.snapshot())[0];
    expect(stopped).not.toHaveProperty('cursor');
    expect(stopped?.target).toEqual({ app: 'TextEdit', window: 'Untitled' });
    controls.cursor('session', 'turn', { phase: 'moving', x: 1, y: 1 });
    expect((await service.snapshot())[0]).not.toHaveProperty('cursor');
  } finally { await transport.close(); }
});

it('keeps each turn\'s cursor to itself and hides it when the helper dies', async () => {
  const controls = new TurnControls();
  const first = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  const second = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  try {
    controls.attach('a', 'one', first);
    controls.attach('a', 'two', second);
    controls.cursor('a', 'one', { phase: 'executing', x: 0.1, y: 0.2 });
    controls.cursor('b', 'two', { phase: 'executing', x: 0.9, y: 0.9 });
    const [one, two] = await controls.forSession('a').snapshot();
    expect(one?.cursor).toEqual({ phase: 'executing', x: 0.1, y: 0.2 });
    expect(two).not.toHaveProperty('cursor');
    expect(() => controls.cursor('a', 'one', { phase: 'moving', x: 2, y: 0 })).toThrow();
    // Long names are cut for the strip, never refused.
    controls.target('a', 'one', { app: 'N'.repeat(300), window: 'x'.repeat(500) });
    expect((await controls.forSession('a').snapshot())[0]?.target).toEqual({ app: 'N'.repeat(160), window: 'x'.repeat(200) });
    await first.close();
    expect((await controls.forSession('a').snapshot())[0]).not.toHaveProperty('cursor');
  } finally { await Promise.all([first.close(), second.close()]); }
});

it('pushes every change of a session\'s turns to its subscribers, once per change and never to another session', async () => {
  const controls = new TurnControls();
  const first = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  const other = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: CONTRACT_PROTOCOL_VERSION });
  const pushed: ReadonlyArray<ComputerControlSnapshot>[] = [];
  const service = controls.forSession('a');
  if (!service.subscribe) throw new Error('no subscribe');
  const unsubscribe = service.subscribe((turns) => pushed.push(turns));
  try {
    controls.attach('a', 'one', first);
    controls.attach('b', 'one', other);
    controls.update('b', 'one', 'foreground');
    expect(pushed).toEqual([[{ sessionId: 'a', turnId: 'one', state: 'idle', windowId: null }]]);
    controls.update('a', 'one', 'foreground', 'w');
    controls.update('a', 'one', 'foreground', 'w');
    controls.cursor('a', 'one', { phase: 'moving', x: 0.5, y: 0.5 });
    expect(pushed.map((turns) => turns[0]?.state)).toEqual(['idle', 'foreground', 'foreground']);
    expect(pushed.at(-1)?.[0]?.cursor).toEqual({ phase: 'moving', x: 0.5, y: 0.5 });
    // The helper dying is a change too: the turn fails and its cursor goes.
    await first.close();
    await until(() => pushed.at(-1)?.[0]?.state === 'failed');
    expect(pushed.at(-1)?.[0]).toEqual({ sessionId: 'a', turnId: 'one', state: 'failed', windowId: 'w' });
    controls.detach('a', 'one');
    expect(pushed.at(-1)).toEqual([]);
    unsubscribe();
    controls.attach('a', 'two', other);
    expect(pushed.at(-1)).toEqual([]);
  } finally { unsubscribe(); await Promise.all([first.close(), other.close()]); }
});

it('takes over for the user: pauses the helper, hides the cursor and keeps it hidden until resumed', async () => {
  const controls = new TurnControls();
  const { transport, sent } = recordingHelper();
  try {
    controls.attach('s', 't', transport);
    controls.cursor('s', 't', { phase: 'executing', x: 0.2, y: 0.2 });
    const service = controls.forSession('s');
    await service.control({ sessionId: 's', turnId: 't', command: 'takeover' });
    expect((await service.snapshot())[0]).toEqual({ sessionId: 's', turnId: 't', state: 'paused_by_user', windowId: null });
    controls.cursor('s', 't', { phase: 'moving', x: 0.4, y: 0.4 });
    expect((await service.snapshot())[0]).not.toHaveProperty('cursor');
    await service.control({ sessionId: 's', turnId: 't', command: 'resume' });
    controls.cursor('s', 't', { phase: 'moving', x: 0.4, y: 0.4 });
    expect((await service.snapshot())[0]?.cursor).toEqual({ phase: 'moving', x: 0.4, y: 0.4 });
    await until(() => sent().length === 2);
    expect(sent()).toEqual([{ version: CONTRACT_PROTOCOL_VERSION, control: 'takeover' }, { version: CONTRACT_PROTOCOL_VERSION, control: 'resume' }]);
  } finally { await transport.close(); }
});

it('asks a helper without take-over to pause instead', async () => {
  const { transport, sent } = recordingHelper(OLDER);
  try {
    transport.control('takeover');
    await until(() => sent().length === 1);
    expect(sent()).toEqual([{ version: OLDER, control: 'pause' }]);
  } finally { await transport.close(); }
});
