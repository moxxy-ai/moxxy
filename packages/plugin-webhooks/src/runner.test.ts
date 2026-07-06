import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
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
    const inboxPath = out.inboxPath;
    assertDefined(inboxPath, 'inbox path written by fire');
    expect(path.dirname(inboxPath)).toBe(inbox);
    const files = await readdir(inbox);
    expect(files).toHaveLength(1);
  });
});

describe('WebhookDispatcher.route (multi-runner hand-off)', () => {
  let dir: string;
  let store: WebhookStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-wh-route-'));
    store = noopStore(path.join(dir, 'webhooks.json'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function ownedTrigger(owner: string | undefined): Promise<WebhookTrigger> {
    return store.create({
      name: 'gh',
      prompt: 'x',
      allowedTools: [],
      verification: { type: 'none' },
      ...(owner !== undefined ? { ownerSessionId: owner } : {}),
    });
  }

  it('hands a delivery owned by ANOTHER runner to the queue instead of firing', async () => {
    const calls: string[] = [];
    const { WebhookDeliveryQueue } = await import('./queue.js');
    const queue = new WebhookDeliveryQueue(path.join(dir, 'queue'));
    const dispatcher = new WebhookDispatcher({
      store,
      runner: { runPrompt: async ({ prompt }) => { calls.push(prompt); return { text: 'ok' }; } },
      inbox: { dir: path.join(dir, 'inbox') },
      ownerSessionId: 'runner-A',
      queue,
    });
    const trigger = await ownedTrigger('runner-B');

    const out = await dispatcher.route(trigger, 'for B', 'd1');
    expect(out).toEqual({ handled: 'enqueued', ownerSessionId: 'runner-B' });
    expect(calls).toEqual([]); // did NOT fire here
    expect(await queue.listOwned('runner-B')).toHaveLength(1);
  });

  it('fires in-process when this runner owns the trigger', async () => {
    const calls: string[] = [];
    const { WebhookDeliveryQueue } = await import('./queue.js');
    const queue = new WebhookDeliveryQueue(path.join(dir, 'queue'));
    const dispatcher = new WebhookDispatcher({
      store,
      runner: { runPrompt: async ({ prompt }) => { calls.push(prompt); return { text: 'ok' }; } },
      inbox: { dir: path.join(dir, 'inbox') },
      ownerSessionId: 'runner-A',
      queue,
    });
    const trigger = await ownedTrigger('runner-A');

    const out = await dispatcher.route(trigger, 'mine', 'd1');
    expect(out.handled).toBe('fired');
    expect(calls).toEqual(['mine']);
    expect(await queue.listOwned('runner-A')).toHaveLength(0);
  });

  it('fires in-process for an owner-less trigger (single-process / global)', async () => {
    const calls: string[] = [];
    const { WebhookDeliveryQueue } = await import('./queue.js');
    const queue = new WebhookDeliveryQueue(path.join(dir, 'queue'));
    const dispatcher = new WebhookDispatcher({
      store,
      runner: { runPrompt: async ({ prompt }) => { calls.push(prompt); return { text: 'ok' }; } },
      inbox: { dir: path.join(dir, 'inbox') },
      ownerSessionId: 'runner-A',
      queue,
    });
    const trigger = await ownedTrigger(undefined);

    const out = await dispatcher.route(trigger, 'global', 'd1');
    expect(out.handled).toBe('fired');
    expect(calls).toEqual(['global']);
  });
});
