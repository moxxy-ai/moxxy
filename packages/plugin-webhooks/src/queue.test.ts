import { mkdtemp, rm, readdir, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { WebhookDeliveryQueue } from './queue.js';

describe('WebhookDeliveryQueue', () => {
  let dir: string;
  let queue: WebhookDeliveryQueue;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-wh-queue-'));
    queue = new WebhookDeliveryQueue(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const rec = (over: Partial<Parameters<WebhookDeliveryQueue['enqueue']>[0]> = {}) => ({
    triggerId: 't1',
    triggerName: 'gh',
    ownerSessionId: 'runner-A',
    prompt: 'digest please',
    deliveryId: null,
    ...over,
  });

  it('enqueues and lists only records for the requested owner', async () => {
    await queue.enqueue(rec({ ownerSessionId: 'runner-A', deliveryId: 'a1' }));
    await queue.enqueue(rec({ ownerSessionId: 'runner-B', deliveryId: 'b1' }));
    await queue.enqueue(rec({ ownerSessionId: 'runner-A', deliveryId: 'a2' }));

    const a = await queue.listOwned('runner-A');
    expect(a.map((r) => r.deliveryId).sort()).toEqual(['a1', 'a2']);
    const b = await queue.listOwned('runner-B');
    expect(b.map((r) => r.deliveryId)).toEqual(['b1']);
  });

  it('uses the deliveryId as the record id so a provider retry overwrites (no dupes)', async () => {
    await queue.enqueue(rec({ deliveryId: 'dup' }));
    await queue.enqueue(rec({ deliveryId: 'dup', prompt: 'newer' }));
    const owned = await queue.listOwned('runner-A');
    expect(owned).toHaveLength(1);
    const first = owned[0];
    assertDefined(first, 'first owned delivery');
    expect(first.prompt).toBe('newer');
  });

  it('remove drops a drained record', async () => {
    const id = await queue.enqueue(rec({ deliveryId: 'x' }));
    expect(await queue.listOwned('runner-A')).toHaveLength(1);
    await queue.remove(id);
    expect(await queue.listOwned('runner-A')).toHaveLength(0);
  });

  it('listOwned returns oldest-first and skips corrupt files', async () => {
    await queue.enqueue(rec({ deliveryId: 'old', enqueuedAt: 1000 }));
    await queue.enqueue(rec({ deliveryId: 'new', enqueuedAt: 2000 }));
    // A stray non-JSON file in the dir must not break the drain.
    await rm(path.join(dir, 'garbage.json'), { force: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, 'garbage.json'), 'not json', 'utf8');
    const owned = await queue.listOwned('runner-A');
    expect(owned.map((r) => r.deliveryId)).toEqual(['old', 'new']);
  });

  it('sweepStale removes records older than the max age', async () => {
    const id = await queue.enqueue(rec({ deliveryId: 'stale' }));
    await queue.enqueue(rec({ deliveryId: 'fresh' }));
    // Backdate the "stale" record's mtime by 10 days.
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const file = path.join(dir, `${id}.json`);
    await utimes(file, new Date(tenDaysAgo), new Date(tenDaysAgo));

    const removed = await queue.sweepStale(7 * 24 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    const remaining = (await readdir(dir)).filter((n) => n.endsWith('.json'));
    expect(remaining).toEqual(['fresh.json']);
    // keep the lints happy about the unused import in some toolchains
    expect((await stat(path.join(dir, 'fresh.json'))).isFile()).toBe(true);
  });
});
