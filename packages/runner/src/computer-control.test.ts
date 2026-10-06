import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ComputerControlService, ComputerControlSnapshot } from '@moxxy/sdk';
import { Session } from '@moxxy/core';
import { startRunnerServer } from './server.js';
import { connectRemoteSession } from './remote-session.js';
import { platformSocket } from './socket-path.js';

function tmpSocket(): string {
  const name = `cu-${randomUUID()}`;
  return platformSocket(name, join(tmpdir(), `${name}.sock`));
}

it('keeps chat attach available without Computer Use and rejects stale session control', async () => {
  const session = new Session({cwd: process.cwd()});
  const socketPath = tmpSocket();
  const server = await startRunnerServer(session, {socketPath});
  const remote = await connectRemoteSession({socketPath});
  try {
    expect(remote.getInfo().sessionId).toBe(session.id);
    expect(await remote.computerControl.snapshot()).toEqual([]);
    await expect(remote.computerControl.control({sessionId:'other',turnId:'turn',command:'stop'})).rejects.toThrow(/session mismatch/);
    await expect(remote.computerControl.control({sessionId:session.id,turnId:'turn',command:'resume'})).rejects.toThrow(/not supported/);
  } finally { await remote.close(); await server.close(); await session.close(); }
});

it('pushes every Computer Use change to every attached client, without polling', async () => {
  const session = new Session({cwd: process.cwd()});
  let push: (turns: ReadonlyArray<ComputerControlSnapshot>) => void = () => undefined;
  const service: ComputerControlService = {
    snapshot: async () => [],
    control: async () => undefined,
    subscribe: (listener) => { push = listener; return () => { push = () => undefined; }; },
  };
  session.services.register('computerControl', service);
  const socketPath = tmpSocket();
  const server = await startRunnerServer(session, {socketPath});
  const desktop = await connectRemoteSession({socketPath});
  const phone = await connectRemoteSession({socketPath});
  try {
    const seen: Array<[string, ReadonlyArray<ComputerControlSnapshot>]> = [];
    const off = desktop.computerControl.subscribe?.((turns) => seen.push(['desktop', turns]));
    phone.computerControl.subscribe?.((turns) => seen.push(['phone', turns]));
    const turns = [{sessionId: session.id, turnId: 'turn', state: 'paused_by_user', windowId: null}] as const;
    push(turns);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    // Clients receive in any order; each gets the change once.
    expect([...seen].sort(([a], [b]) => a.localeCompare(b))).toEqual([['desktop', turns], ['phone', turns]]);
    off?.();
    push([]);
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen.at(-1)).toEqual(['phone', []]);
  } finally { await desktop.close(); await phone.close(); await server.close(); await session.close(); }
});
