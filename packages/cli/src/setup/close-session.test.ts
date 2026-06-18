import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session, SessionPersistence, restoreSessionEvents, silentLogger } from '@moxxy/core';
import { definePlugin } from '@moxxy/sdk';
import { closeSession } from './close-session.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-close-session-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/**
 * A real Session whose own log is wired to a real SessionPersistence against a
 * temp dir, plus an `onShutdown` spy so we can assert close fired. This is the
 * exact wiring `attachSessionPersistence` produces, minus the production sids.
 */
async function makeHarness(): Promise<{
  session: Session;
  persistence: SessionPersistence;
  onShutdown: ReturnType<typeof vi.fn>;
  dir: string;
  id: string;
  appendLast: () => Promise<void>;
}> {
  const dir = await makeTempDir();
  const session = new Session({ cwd: os.tmpdir(), logger: silentLogger });
  const id = String(session.id);
  const persistence = new SessionPersistence({ sessionId: session.id, cwd: os.tmpdir(), dir });
  const detach = persistence.attach(session.log);
  const onShutdown = vi.fn();
  session.pluginHost.registerStatic(
    definePlugin({
      name: '@test/close-session-handle',
      hooks: { onShutdown: async () => detach() },
    }),
  );
  // Track shutdown ordering separately so the test can assert the persistence
  // drain ran BEFORE close fired its shutdown hooks (which detach persistence).
  session.pluginHost.registerStatic(
    definePlugin({ name: '@test/close-spy', hooks: { onShutdown } }),
  );
  const appendLast = async (): Promise<void> => {
    await session.log.append({
      type: 'user_prompt',
      sessionId: session.id,
      turnId: 't1' as never,
      source: 'user',
      text: 'the very last event',
    });
  };
  return { session, persistence, onShutdown, dir, id, appendLast };
}

describe('closeSession', () => {
  it('drains the append queue so the LAST event is on disk after it resolves', async () => {
    const h = await makeHarness();
    // append() only AWAITS the listener that enqueues the write fire-and-forget;
    // the bytes are not guaranteed on disk yet. Without the drain, this would be
    // racy — that race is exactly what closeSession fixes.
    await h.appendLast();

    await closeSession(h.session, h.persistence);

    const restored = await restoreSessionEvents(h.id, h.dir);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ type: 'user_prompt', text: 'the very last event' });
  });

  it('fires onShutdown hooks (session closed)', async () => {
    const h = await makeHarness();
    await closeSession(h.session, h.persistence);
    expect(h.onShutdown).toHaveBeenCalledTimes(1);
  });

  it('drains persistence BEFORE close fires the detach shutdown hook', async () => {
    const h = await makeHarness();
    await h.appendLast();

    const order: string[] = [];
    const settleSpy = vi.spyOn(h.persistence, 'settleWrites');
    settleSpy.mockImplementation(async () => {
      order.push('settle');
    });
    h.onShutdown.mockImplementation(() => {
      order.push('shutdown');
    });

    await closeSession(h.session, h.persistence);
    expect(order).toEqual(['settle', 'shutdown']);
  });

  it('is idempotent and safe to call twice in a finally', async () => {
    const h = await makeHarness();
    await closeSession(h.session, h.persistence);
    await closeSession(h.session, h.persistence);
    // Session.close is idempotent, so the shutdown hook fires exactly once.
    expect(h.onShutdown).toHaveBeenCalledTimes(1);
  });

  it('tolerates a null persistence handle (persistence disabled)', async () => {
    const h = await makeHarness();
    await expect(closeSession(h.session, null)).resolves.toBeUndefined();
    expect(h.onShutdown).toHaveBeenCalledTimes(1);
  });

  it('never throws even if flush rejects — teardown must not mask the command result', async () => {
    const h = await makeHarness();
    vi.spyOn(h.persistence, 'flush').mockRejectedValue(new Error('disk gone'));
    await expect(closeSession(h.session, h.persistence)).resolves.toBeUndefined();
    // close still ran despite the flush failure.
    expect(h.onShutdown).toHaveBeenCalledTimes(1);
  });
});
