import { expect, it } from 'vitest';
import { HelperTransport } from './transport.js';
import { TurnControls } from './control-service.js';

it('distinguishes the independent panel Stop from a crashed worker', async () => {
  const controls = new TurnControls();
  const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.once("data",()=>process.exit(20))']);
  try {
    controls.attach('session', 'turn', transport);
    await expect(transport.request('status', {}, new AbortController().signal)).rejects.toThrow();
    expect((await controls.forSession('session').snapshot())[0]?.state).toBe('stopped');
    await expect(controls.forSession('session').control({sessionId:'session',turnId:'turn',command:'resume'})).rejects.toThrow(/stopped/);
  } finally { await transport.close(); }
});

it('routes human control to the exact live turn and retains a stopped tombstone', async () => {
  const controls = new TurnControls();
  const first = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()']);
  const second = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()']);
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
  const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()']);
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
