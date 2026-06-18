import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookDispatcher } from './runner.js';
import { WebhookStore, type WebhookTrigger } from './store.js';

/** A store that records nothing — fire() only needs `recordFire` to not throw. */
function noopStore(file: string): WebhookStore {
  return new WebhookStore({ file });
}

async function makeTrigger(store: WebhookStore): Promise<WebhookTrigger> {
  return store.create({
    name: 'burst',
    prompt: 'x',
    allowedTools: [],
    verification: { type: 'none' },
  });
}

describe('WebhookDispatcher inbox filenames (burst uniqueness)', () => {
  let dir: string;
  let store: WebhookStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-wh-runner-'));
    store = noopStore(path.join(dir, 'webhooks.json'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('two same-millisecond fires of one trigger produce distinct inbox files (no overwrite)', async () => {
    // Freeze the clock so both fires share the exact same ISO timestamp — the
    // collision case the deliveryId/random suffix must break.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
    const inbox = path.join(dir, 'inbox');
    const dispatcher = new WebhookDispatcher({
      store,
      runner: { runPrompt: async () => ({ text: 'ok' }) },
      inbox: { dir: inbox },
    });
    const trigger = await makeTrigger(store);

    const a = await dispatcher.fire(trigger, 'first', 'delivery-aaa');
    const b = await dispatcher.fire(trigger, 'second', 'delivery-bbb');

    expect(a.inboxPath).toBeTruthy();
    expect(b.inboxPath).toBeTruthy();
    expect(a.inboxPath).not.toBe(b.inboxPath);
    const files = await readdir(inbox);
    expect(files).toHaveLength(2);
  });

  it('falls back to a random suffix when no deliveryId is present', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
    const inbox = path.join(dir, 'inbox');
    const dispatcher = new WebhookDispatcher({
      store,
      runner: { runPrompt: async () => ({ text: 'ok' }) },
      inbox: { dir: inbox },
    });
    const trigger = await makeTrigger(store);

    await dispatcher.fire(trigger, 'first', null);
    await dispatcher.fire(trigger, 'second', null);

    const files = await readdir(inbox);
    expect(files).toHaveLength(2);
  });

  it('sanitizes a deliveryId that contains path-unsafe characters', async () => {
    const inbox = path.join(dir, 'inbox');
    const dispatcher = new WebhookDispatcher({
      store,
      runner: { runPrompt: async () => ({ text: 'ok' }) },
      inbox: { dir: inbox },
    });
    const trigger = await makeTrigger(store);

    const out = await dispatcher.fire(trigger, 'x', '../../etc/passwd');
    // The written file stays inside the inbox dir (no traversal via the id).
    expect(path.dirname(out.inboxPath!)).toBe(inbox);
    const files = await readdir(inbox);
    expect(files).toHaveLength(1);
  });
});
