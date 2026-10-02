import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { collabCoordinatorSocketPath, collabRunId, hubSocketPath, peerSocketPath } from './constants.js';

function listens(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(address, () => server.close(() => resolve(true)));
  });
}

// Windows can only listen on a named pipe, never on a path inside a directory,
// so each address is proven by binding it rather than by its spelling. On
// POSIX the address lives in the run dir, which the coordinator creates.
const onWindows = it.runIf(process.platform === 'win32');
describe('collab socket addresses', () => {
  const runId = collabRunId('session', 'turn');

  onWindows('the coordinator address is one this platform can listen on', async () => {
    expect(await listens(collabCoordinatorSocketPath())).toBe(true);
  });

  onWindows('the hub address is one this platform can listen on', async () => {
    expect(await listens(hubSocketPath(runId))).toBe(true);
  });

  onWindows('a peer address is one this platform can listen on', async () => {
    expect(await listens(peerSocketPath(runId, 'backend'))).toBe(true);
  });

  it('gives each run and each agent its own address', () => {
    const other = collabRunId('session', 'turn');
    expect(hubSocketPath(runId)).not.toBe(hubSocketPath(other));
    expect(peerSocketPath(runId, 'backend')).not.toBe(peerSocketPath(runId, 'frontend'));
    expect(peerSocketPath(runId, 'backend')).not.toBe(hubSocketPath(runId));
  });
});
