import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollaborationHub, type CollaborationHub } from './hub.js';
import { CollabHubClient } from './client.js';
import type { CollabEvent, RosterEntry } from './hub-types.js';

const roster: RosterEntry[] = [
  { id: 'architect', name: 'Architect', role: 'architect', subtask: 'design' },
  { id: 'backend', name: 'Backend', role: 'implementer', subtask: 'api' },
  { id: 'tests', name: 'Tests', role: 'implementer', subtask: 'tests' },
];

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function startHub(): Promise<{ hub: CollaborationHub; socketPath: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'mc-'));
  const socketPath = join(dir, 's');
  const hub = await createCollaborationHub({
    socketPath,
    task: 'build the thing',
    roster,
    peerReader: {
      files: async (agentId) => [{ path: `${agentId}/file.ts`, status: 'M' }],
      read: async (agentId, path) => `// ${agentId}:${path}\nexport const x = 1;`,
      diff: async (agentId) => `diff for ${agentId}`,
    },
  });
  cleanups.push(() => {
    void hub.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { hub, socketPath };
}

/** Resolve once the predicate sees a matching event (or reject on timeout). */
function waitFor(
  events: CollabEvent[],
  pred: (e: CollabEvent) => boolean,
  timeoutMs = 1000,
): Promise<CollabEvent> {
  return new Promise((resolve, reject) => {
    const existing = events.find(pred);
    if (existing) return resolve(existing);
    const started = Date.now();
    const iv = setInterval(() => {
      const hit = events.find(pred);
      if (hit) {
        clearInterval(iv);
        resolve(hit);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(iv);
        reject(new Error('timed out waiting for event'));
      }
    }, 5);
  });
}

describe('CollaborationHub over a real socket', () => {
  it('routes messages between peer processes and fans events to subscribers', async () => {
    const { hub, socketPath } = await startHub();
    const relayed: CollabEvent[] = [];
    hub.subscribe((e) => relayed.push(e));

    const backend = await CollabHubClient.connect(socketPath, 'backend', { runnerSocket: '/tmp/b.sock', pid: 111 });
    const tests = await CollabHubClient.connect(socketPath, 'tests');
    cleanups.push(() => backend.close(), () => tests.close());

    const testsEvents: CollabEvent[] = [];
    tests.onEvent((e) => testsEvents.push(e));

    await backend.post('tests', 'please cover the API');
    // tests sees the message both via its live event stream and its inbox
    await waitFor(testsEvents, (e) => e.kind === 'message' && e.message.body === 'please cover the API');
    const inbox = await tests.inbox();
    expect(inbox.messages.map((m) => m.body)).toContain('please cover the API');

    // the coordinator's in-process relay saw it too
    expect(relayed.some((e) => e.kind === 'message' && e.message.from === 'backend')).toBe(true);

    // register recorded the runner socket for transcript attach
    const view = await tests.roster();
    expect(view.agents.find((a) => a.id === 'backend')?.runnerSocket).toBe('/tmp/b.sock');
    expect(view.self).toBe('tests');
  });

  it('enforces exclusive file claims across connections', async () => {
    const { hub, socketPath } = await startHub();
    void hub;
    const backend = await CollabHubClient.connect(socketPath, 'backend');
    const tests = await CollabHubClient.connect(socketPath, 'tests');
    cleanups.push(() => backend.close(), () => tests.close());

    expect((await backend.boardClaim(['src/api'])).ok).toBe(true);
    const clash = await tests.boardClaim(['src/api/routes.ts']);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.ownedBy).toBe('backend');
  });

  it('does not let one connection release or steal another\'s lock by id', async () => {
    const { hub, socketPath } = await startHub();
    void hub;
    const backend = await CollabHubClient.connect(socketPath, 'backend');
    const tests = await CollabHubClient.connect(socketPath, 'tests');
    cleanups.push(() => backend.close(), () => tests.close());

    const claim = await backend.boardClaim(['src/api']);
    expect(claim.ok).toBe(true);
    const id = claim.ok ? claim.item.id : '';

    // tests cannot release backend's lock by id...
    await tests.boardRelease({ id });
    expect((await tests.boardClaim(['src/api/routes.ts'])).ok).toBe(false);

    // ...nor hijack the board item by id with disjoint paths
    const hijack = await tests.boardClaim(['src/other'], id);
    expect(hijack.ok).toBe(false);
    const { items } = await tests.boardRead();
    expect(items.find((it) => it.id === id)?.owner).toBe('backend');
  });

  it('frees a crashed peer\'s locks for survivors', async () => {
    const { socketPath } = await startHub();
    const backend = await CollabHubClient.connect(socketPath, 'backend');
    const tests = await CollabHubClient.connect(socketPath, 'tests');
    cleanups.push(() => tests.close());

    const events: CollabEvent[] = [];
    tests.onEvent((e) => events.push(e));

    expect((await backend.boardClaim(['src/api'])).ok).toBe(true);
    // backend's link drops → hub marks it crashed → its lock is freed
    backend.close();
    await waitFor(events, (e) => e.kind === 'agent_status' && e.agentId === 'backend' && e.status === 'crashed');
    expect((await tests.boardClaim(['src/api/routes.ts'])).ok).toBe(true);
  });

  it('serves contracts and peer-read across connections', async () => {
    const { hub, socketPath } = await startHub();
    void hub;
    const architect = await CollabHubClient.connect(socketPath, 'architect');
    const tests = await CollabHubClient.connect(socketPath, 'tests');
    cleanups.push(() => architect.close(), () => tests.close());

    await architect.contractPublish({ title: 'AuthService', spec: 'login(u): Token', owner: 'backend', consumers: ['tests'] });
    const { contracts } = await tests.contracts();
    expect(contracts.map((c) => c.title)).toEqual(['AuthService']);

    const { content } = await tests.peerRead('backend', 'src/api/routes.ts');
    expect(content).toContain('backend:src/api/routes.ts');
    const { files } = await tests.peerFiles('backend');
    expect(files[0]?.path).toBe('backend/file.ts');
  });

  it('rejects registering as an unknown agent or one already connected', async () => {
    const { socketPath } = await startHub();
    // unknown roster id → rejected
    await expect(CollabHubClient.connect(socketPath, 'ghost')).rejects.toThrow(/unknown agent/);

    const backend = await CollabHubClient.connect(socketPath, 'backend');
    cleanups.push(() => backend.close());
    // a second live connection cannot impersonate the same id
    await expect(CollabHubClient.connect(socketPath, 'backend')).rejects.toThrow(/already connected/);
  });

  it('frees the id on disconnect so an honest reconnect can re-register', async () => {
    const { socketPath } = await startHub();
    const first = await CollabHubClient.connect(socketPath, 'backend');
    first.close();
    // give the hub a tick to observe the close before reconnecting
    const reconnect = await new Promise<CollabHubClient>((resolve, reject) => {
      const tryConnect = (n: number): void => {
        CollabHubClient.connect(socketPath, 'backend').then(resolve, (e) =>
          n > 0 ? setTimeout(() => tryConnect(n - 1), 10) : reject(e),
        );
      };
      tryConnect(20);
    });
    cleanups.push(() => reconnect.close());
    expect((await reconnect.roster()).self).toBe('backend');
  });

  it('rejects a terminal/coordinator-only status from a peer', async () => {
    const { hub, socketPath } = await startHub();
    const backend = await CollabHubClient.connect(socketPath, 'backend');
    cleanups.push(() => backend.close());
    // 'done' / 'crashed' / 'killed' must not be settable via collab.status — they
    // would release the agent's own locks or desync allDone().
    await expect(backend.setStatus('crashed' as 'working')).rejects.toThrow(/not settable/);
    await expect(backend.setStatus('done' as 'working')).rejects.toThrow(/not settable/);
    // a legitimate self-status still works
    await backend.setStatus('working');
    expect(hub.state.rosterView().agents.find((a) => a.id === 'backend')?.status).toBe('working');
  });

  it('marks a peer crashed when its connection drops before done', async () => {
    const { hub, socketPath } = await startHub();
    const backend = await CollabHubClient.connect(socketPath, 'backend');
    const observer = await CollabHubClient.connect(socketPath, 'architect');
    cleanups.push(() => observer.close());

    const crashed: CollabEvent[] = [];
    observer.onEvent((e) => crashed.push(e));
    backend.close();
    await waitFor(crashed, (e) => e.kind === 'agent_status' && e.agentId === 'backend' && e.status === 'crashed');
    expect(hub.state.rosterView().agents.find((a) => a.id === 'backend')?.status).toBe('crashed');
  });
});
