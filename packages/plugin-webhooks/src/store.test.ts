import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

  describe('corruption handling', () => {
    const file = () => path.join(dir, 'webhooks.json');

    it('reports no warning on a clean (or absent) load', async () => {
      expect(await store.loadWarning()).toBeNull();
      await store.create({ name: 'ok', prompt: 'x', allowedTools: [], verification: { type: 'none' } });
      const reloaded = new WebhookStore({ file: file() });
      expect(await reloaded.loadWarning()).toBeNull();
    });

    it('preserves an invalid-JSON file aside instead of treating it as empty', async () => {
      const garbage = '{ this is not json';
      await writeFile(file(), garbage, 'utf8');
      expect(await store.list()).toEqual([]);
      const warning = await store.loadWarning();
      expect(warning).toMatch(/not valid JSON/);
      expect(warning).toMatch(/\.corrupt-/);
      const sidecars = (await readdir(dir)).filter((f) => f.includes('.corrupt-'));
      expect(sidecars).toHaveLength(1);
      expect(await readFile(path.join(dir, sidecars[0]!), 'utf8')).toBe(garbage);
    });

    it('preserves a schema-mismatched file aside', async () => {
      const bad = JSON.stringify({ version: 99, nope: true });
      await writeFile(file(), bad, 'utf8');
      expect(await store.list()).toEqual([]);
      expect(await store.loadWarning()).toMatch(/expected \{ version: 1/);
      const sidecars = (await readdir(dir)).filter((f) => f.includes('.corrupt-'));
      expect(sidecars).toHaveLength(1);
      expect(await readFile(path.join(dir, sidecars[0]!), 'utf8')).toBe(bad);
    });

    it('keeps the corrupt copy recoverable after a subsequent write (no wipe)', async () => {
      const original = '{"version":1,"triggers":[{"id":"X01","name":"precious","secret":"sssh"';
      await writeFile(file(), original, 'utf8');
      // Corrupt load → empty store; creating a trigger persists fresh state…
      const created = await store.create({
        name: 'fresh',
        prompt: 'x',
        allowedTools: [],
        verification: { type: 'none' },
      });
      expect(created.name).toBe('fresh');
      // …but the original bytes survive in the .corrupt-* sidecar.
      const sidecars = (await readdir(dir)).filter((f) => f.includes('.corrupt-'));
      expect(sidecars).toHaveLength(1);
      expect(await readFile(path.join(dir, sidecars[0]!), 'utf8')).toBe(original);
      const live = JSON.parse(await readFile(file(), 'utf8')) as { triggers: Array<{ name: string }> };
      expect(live.triggers.map((t) => t.name)).toEqual(['fresh']);
    });

    it('quarantines invalid entries and keeps the valid ones', async () => {
      const valid = {
        id: 'OK1',
        name: 'keeper',
        prompt: 'x',
        allowedTools: [],
        verification: { type: 'none' },
        filters: { include: [], exclude: [] },
        enabled: true,
        createdAt: Date.now(),
        fireCount: 0,
      };
      const invalid = { id: 'BAD', name: '!!!bad slug!!!', secretishStuff: 'topsecret' };
      await writeFile(
        file(),
        JSON.stringify({ version: 1, triggers: [valid, invalid] }),
        'utf8',
      );
      const all = await store.list();
      expect(all.map((t) => t.name)).toEqual(['keeper']);
      const warning = await store.loadWarning();
      expect(warning).toMatch(/1 trigger entry .*quarantined/);
      const sidecars = (await readdir(dir)).filter((f) => f.includes('.quarantine-'));
      expect(sidecars).toHaveLength(1);
      const quarantined = JSON.parse(await readFile(path.join(dir, sidecars[0]!), 'utf8')) as {
        entries: Array<{ index: number; entry: unknown; issues: string }>;
      };
      expect(quarantined.entries).toHaveLength(1);
      expect(quarantined.entries[0]!.index).toBe(1);
      expect(quarantined.entries[0]!.entry).toEqual(invalid);
      // Quarantined entries survive a subsequent persist that drops them from the live file.
      await store.create({ name: 'another', prompt: 'x', allowedTools: [], verification: { type: 'none' } });
      const live = JSON.parse(await readFile(file(), 'utf8')) as { triggers: Array<{ name: string }> };
      expect(live.triggers.map((t) => t.name)).toEqual(['keeper', 'another']);
    });

    it('logs corruption through the provided logger', async () => {
      const errors: string[] = [];
      await writeFile(file(), 'nope', 'utf8');
      const logged = new WebhookStore({
        file: file(),
        logger: { error: (msg) => void errors.push(msg) },
      });
      await logged.list();
      expect(errors.some((m) => m.includes('corrupt'))).toBe(true);
    });
  });
});
