import { expect, it } from 'vitest';
import { HelperTransport } from '../helper/transport.js';
import { PROTOCOL_VERSION } from '../windows/contracts.js';
import { TurnControls } from './turn-controls.js';

it('distinguishes the independent panel Stop from a crashed worker', async () => {
  const controls = new TurnControls();
  const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.once("data",()=>process.exit(20))'], { protocolVersion: PROTOCOL_VERSION });
  try {
    controls.attach('session', 'turn', transport);
    await expect(transport.request('status', {}, new AbortController().signal)).rejects.toThrow();
    expect((await controls.forSession('session').snapshot())[0]?.state).toBe('stopped');
    await expect(controls.forSession('session').control({sessionId:'session',turnId:'turn',command:'resume'})).rejects.toThrow(/stopped/);
  } finally { await transport.close(); }
});

it('routes human control to the exact live turn and retains a stopped tombstone', async () => {
  const controls = new TurnControls();
  const first = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: PROTOCOL_VERSION });
  const second = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: PROTOCOL_VERSION });
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
  const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: PROTOCOL_VERSION });
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
  const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: PROTOCOL_VERSION });
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
  const first = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: PROTOCOL_VERSION });
  const second = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], { protocolVersion: PROTOCOL_VERSION });
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
