import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollaborationHub, type CollaborationHub } from './hub.js';
import { COLLAB_ENV, getProcessHubClient, __resetProcessHubClient } from './process-client.js';
import type { RosterEntry } from './hub-types.js';
import { assertDefined } from '@moxxy/sdk';

const roster: RosterEntry[] = [
  { id: 'backend', name: 'Backend', role: 'implementer', subtask: 'api' },
];

const cleanups: Array<() => void> = [];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv[COLLAB_ENV.Hub] = process.env[COLLAB_ENV.Hub];
  savedEnv[COLLAB_ENV.AgentId] = process.env[COLLAB_ENV.AgentId];
  __resetProcessHubClient();
});

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  process.env[COLLAB_ENV.Hub] = savedEnv[COLLAB_ENV.Hub];
  process.env[COLLAB_ENV.AgentId] = savedEnv[COLLAB_ENV.AgentId];
  if (savedEnv[COLLAB_ENV.Hub] === undefined) delete process.env[COLLAB_ENV.Hub];
  if (savedEnv[COLLAB_ENV.AgentId] === undefined) delete process.env[COLLAB_ENV.AgentId];
  __resetProcessHubClient();
  vi.restoreAllMocks();
});

async function startHub(socketPath: string): Promise<CollaborationHub> {
  const hub = await createCollaborationHub({ socketPath, task: 't', roster });
  cleanups.push(() => void hub.close());
  return hub;
}

describe('getProcessHubClient', () => {
  it('returns a stable null (never retried) when not a peer', async () => {
    delete process.env[COLLAB_ENV.Hub];
    delete process.env[COLLAB_ENV.AgentId];
    expect(await getProcessHubClient()).toBeNull();
  });

  it('does not permanently poison the singleton on a transient connect failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, 's');
    process.env[COLLAB_ENV.Hub] = socketPath;
    process.env[COLLAB_ENV.AgentId] = 'backend';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Hub isn't up yet → first attempt fails, is logged, and returns null.
    expect(await getProcessHubClient()).toBeNull();
    expect(warn).toHaveBeenCalled();

    // The hub comes up. A later attempt (after the cooldown) must succeed —
    // the old code memoized the null forever and could never recover.
    await startHub(socketPath);
    __resetProcessHubClient(); // skip the real-time cooldown deterministically
    const client = await getProcessHubClient();
    expect(client).not.toBeNull();
    expect(client?.agentId).toBe('backend');
  });

  it('reconnects after the link drops instead of staying closed forever', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, 's');
    process.env[COLLAB_ENV.Hub] = socketPath;
    process.env[COLLAB_ENV.AgentId] = 'backend';
    await startHub(socketPath);

    const first = await getProcessHubClient();
    expect(first).not.toBeNull();
    assertDefined(first, 'getProcessHubClient resolved and was asserted non-null above');
    first.close();
    // Wait for the close to propagate through the transport before re-resolving.
    for (let i = 0; i < 100 && !first.isClosed; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(first.isClosed).toBe(true);

    // A dropped link must transparently re-establish on the next resolve. Retry
    // a few times to absorb the hub-side close lag (it frees the id on onClose).
    let second = await getProcessHubClient();
    for (let i = 0; i < 20 && (second === null || second === first); i++) {
      __resetProcessHubClient();
      await new Promise((r) => setTimeout(r, 10));
      second = await getProcessHubClient();
    }
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second?.isClosed).toBe(false);
  });
});
