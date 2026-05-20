import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebhookStore } from './store.js';

describe('WebhookStore', () => {
  let dir: string;
  let store: WebhookStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-webhooks-'));
    store = new WebhookStore({ file: path.join(dir, 'webhooks.json') });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty list when the file is missing', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('round-trips a created trigger through disk', async () => {
    const created = await store.create({
      name: 'gh-issues',
      prompt: 'Triage: {body_json}',
      allowedTools: ['Bash'],
      verification: {
        type: 'hmac',
        secret: 'a-strong-secret-1234',
        signatureHeader: 'X-Hub-Signature-256',
        algorithm: 'sha256',
        prefix: 'sha256=',
        scheme: 'plain',
        timestampToleranceSec: 300,
      },
      idempotencyHeader: 'X-GitHub-Delivery',
    });
    expect(created.id).toMatch(/^[0-9A-Z]+$/);
    const reloaded = new WebhookStore({ file: path.join(dir, 'webhooks.json') });
    const all = await reloaded.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('gh-issues');
    expect(all[0]!.fireCount).toBe(0);
  });

  it('rejects duplicate names', async () => {
    await store.create({
      name: 'dup',
      prompt: 'x',
      allowedTools: [],
      verification: { type: 'none' },
    });
    await expect(
      store.create({
        name: 'dup',
        prompt: 'y',
        allowedTools: [],
        verification: { type: 'none' },
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('records a fire and increments fireCount', async () => {
    const created = await store.create({
      name: 'rec',
      prompt: 'x',
      allowedTools: [],
      verification: { type: 'none' },
    });
    await store.recordFire(created.id, { ok: true });
    await store.recordFire(created.id, { ok: false, error: 'boom' });
    const refreshed = await store.get(created.id);
    expect(refreshed?.fireCount).toBe(2);
    expect(refreshed?.lastResult).toBe('error');
    expect(refreshed?.lastError).toBe('boom');
  });

  it('disables and deletes', async () => {
    const created = await store.create({
      name: 'tmp',
      prompt: 'x',
      allowedTools: [],
      verification: { type: 'none' },
    });
    const disabled = await store.update(created.id, { enabled: false });
    expect(disabled?.enabled).toBe(false);
    expect(await store.delete(created.id)).toBe(true);
    expect(await store.get(created.id)).toBeNull();
  });
});
