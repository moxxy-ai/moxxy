import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Session } from '@moxxy/core';
import { startRunnerServer } from './server.js';
import { connectRemoteSession } from './remote-session.js';

it('keeps chat attach available without Computer Use and rejects stale session control', async () => {
  const session = new Session({cwd: process.cwd()});
  const socketPath = join(tmpdir(), `cu-${randomUUID()}.sock`);
  const server = await startRunnerServer(session, {socketPath});
  const remote = await connectRemoteSession({socketPath});
  try {
    expect(remote.getInfo().sessionId).toBe(session.id);
    expect(await remote.computerControl.snapshot()).toEqual([]);
    await expect(remote.computerControl.control({sessionId:'other',turnId:'turn',command:'stop'})).rejects.toThrow(/session mismatch/);
    await expect(remote.computerControl.control({sessionId:session.id,turnId:'turn',command:'resume'})).rejects.toThrow(/not supported/);
  } finally { await remote.close(); await server.close(); await session.close(); }
});
