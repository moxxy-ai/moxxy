import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EventStoreDef } from '@moxxy/sdk';
import { Session, autoAllowResolver, silentLogger } from '../index.js';
import { jsonlEventStore } from '../sessions/jsonl-event-store.js';

function makeSession(): Session {
  return new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
}

describe('EventStore registry + floor', () => {
  it('seeds the JSONL store as the active, protected floor', () => {
    const session = makeSession();
    expect(session.eventStores.getActiveName()).toBe('jsonl');
    expect(session.eventStores.getFloorName()).toBe('jsonl');
    expect(session.eventStores.list().map((s) => s.name)).toEqual(['jsonl']);
  });

  it('a registered second store does NOT auto-activate (trust boundary)', () => {
    const session = makeSession();
    const fake: EventStoreDef = {
      name: 'fake',
      open: jsonlEventStore.open,
      restore: jsonlEventStore.restore,
      readPage: jsonlEventStore.readPage,
    };
    session.eventStores.register(fake);
    // Still on the floor — a discovered store is inert until explicit setActive.
    expect(session.eventStores.getActiveName()).toBe('jsonl');
    session.eventStores.setActive('fake');
    expect(session.eventStores.getActiveName()).toBe('fake');
    // Removing the swap target reverts to the floor, never null.
    session.eventStores.unregister('fake');
    expect(session.eventStores.getActiveName()).toBe('jsonl');
  });

  it('refuses to unregister the protected jsonl floor', () => {
    const session = makeSession();
    expect(() => session.eventStores.unregister('jsonl')).toThrow(/protected default/);
    expect(session.eventStores.getActiveName()).toBe('jsonl');
  });
});

describe('jsonlEventStore round-trip (behaviour-identical to SessionPersistence)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-evstore-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('open().attach() persists log events that restore() reads back', async () => {
    const session = makeSession();
    const store = session.eventStores.getActive()!;
    const handle = store.open({ sessionId: session.id, cwd: '/tmp', dir });
    const detach = handle.attach(session.log);

    await session.log.append({
      type: 'user_prompt',
      text: 'hello store',
      sessionId: session.id,
      source: 'user',
    });
    await handle.settleWrites();
    await handle.flush();

    const restored = await store.restore(String(session.id), dir);
    expect(restored.some((e) => e.type === 'user_prompt')).toBe(true);

    const page = await store.readPage(String(session.id), { before: null, limit: 10 }, dir);
    expect(page.events.length).toBeGreaterThanOrEqual(1);
    detach();
  });
});
