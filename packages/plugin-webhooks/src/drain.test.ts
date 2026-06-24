import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebhookDrainPoller } from './drain.js';
import { WebhookDeliveryQueue } from './queue.js';
import { WebhookDispatcher } from './runner.js';
import { WebhookStore, type WebhookTrigger } from './store.js';

describe('WebhookDrainPoller', () => {
  let dir: string;
  let store: WebhookStore;
  let queue: WebhookDeliveryQueue;
  let trigger: WebhookTrigger;
  let calls: string[];
  let dispatcher: WebhookDispatcher;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-wh-drain-'));
    store = new WebhookStore({ file: path.join(dir, 'webhooks.json') });
    queue = new WebhookDeliveryQueue(path.join(dir, 'queue'));
    trigger = await store.create({
      name: 'gh',
      prompt: 'p',
      allowedTools: [],
      verification: { type: 'none' },
      ownerSessionId: 'runner-A',
    });
    calls = [];
    dispatcher = new WebhookDispatcher({
      store,
      runner: {
        runPrompt: async ({ prompt }) => {
          calls.push(prompt);
          return { text: 'ok' };
        },
      },
      inbox: { dir: path.join(dir, 'inbox') },
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fires only the records addressed to this runner, and removes them', async () => {
    await queue.enqueue({
      triggerId: trigger.id,
      triggerName: trigger.name,
      ownerSessionId: 'runner-A',
      prompt: 'mine',
      deliveryId: 'a1',
    });
    await queue.enqueue({
      triggerId: trigger.id,
      triggerName: trigger.name,
      ownerSessionId: 'runner-B',
      prompt: 'not mine',
      deliveryId: 'b1',
    });

    const drain = new WebhookDrainPoller({ queue, store, dispatcher, ownerSessionId: 'runner-A' });
    const fired = await drain.tickOnce();

    expect(fired).toBe(1);
    expect(calls).toEqual(['mine']);
    // A's record is consumed; B's stays for B's own drain.
    expect(await queue.listOwned('runner-A')).toHaveLength(0);
    expect(await queue.listOwned('runner-B')).toHaveLength(1);
  });

  it('drops a queued delivery whose trigger has been deleted (no fire)', async () => {
    await queue.enqueue({
      triggerId: 'gone',
      triggerName: 'gh',
      ownerSessionId: 'runner-A',
      prompt: 'orphan',
      deliveryId: 'a1',
    });
    const drain = new WebhookDrainPoller({ queue, store, dispatcher, ownerSessionId: 'runner-A' });
    const fired = await drain.tickOnce();
    expect(fired).toBe(0);
    expect(calls).toEqual([]);
    expect(await queue.listOwned('runner-A')).toHaveLength(0);
  });
});
