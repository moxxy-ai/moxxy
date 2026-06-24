import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ToolContext, ToolDef } from '@moxxy/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebhookConfigStore } from './config.js';
import type { WebhookDispatcher } from './runner.js';
import { WebhookStore } from './store.js';
import { buildWebhookTools } from './tools.js';
import { verifyDelivery } from './verify.js';
import { createHmac } from 'node:crypto';

const ctx = {} as ToolContext;

describe('webhook tools', () => {
  let dir: string;
  let store: WebhookStore;
  let config: WebhookConfigStore;
  let tools: ReadonlyArray<ToolDef>;
  let secretsDir: string;

  const tool = (name: string): ToolDef => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };

  const call = async (name: string, input: unknown): Promise<unknown> => {
    const t = tool(name);
    return t.handler(t.inputSchema.parse(input), ctx);
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-webhook-tools-'));
    store = new WebhookStore({ file: path.join(dir, 'webhooks.json') });
    config = new WebhookConfigStore({ file: path.join(dir, 'webhooks-config.json') });
    secretsDir = path.join(dir, 'secrets');
    const dispatcher = {
      fire: async () => ({ ok: true, text: '' }),
    } as unknown as WebhookDispatcher;
    tools = buildWebhookTools({
      store,
      config,
      dispatcher,
      tunnelHandle: { current: null },
      secretsDir,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('webhook_create secret handling', () => {
    it('never returns a generated secret — only a masked preview + pickup path', async () => {
      const result = (await call('webhook_create', {
        name: 'gh-events',
        prompt: 'Triage: {body_json}',
        verification: { type: 'hmac', signatureHeader: 'X-Hub-Signature-256' },
      })) as {
        generatedSecret: { masked: string; path: string } | null;
        guidance: string[];
      };

      expect(result.generatedSecret).not.toBeNull();
      const { masked, path: secretPath } = result.generatedSecret!;
      expect(masked).toMatch(/^[0-9a-f]{4}…$/);

      // The real secret lives in the trigger store (it must verify HMACs)…
      const trigger = await store.getByName('gh-events');
      const verification = trigger!.verification;
      if (verification.type !== 'hmac') throw new Error('expected hmac verification');
      const realSecret = verification.secret;
      expect(realSecret).toHaveLength(64);
      expect(realSecret.startsWith(masked.slice(0, 4))).toBe(true);

      // …and the full tool result never contains it.
      expect(JSON.stringify(result)).not.toContain(realSecret);

      // The out-of-band file holds the full value, owner-only.
      expect(secretPath).toBe(path.join(secretsDir, 'gh-events.secret'));
      expect((await readFile(secretPath, 'utf8')).trim()).toBe(realSecret);
      expect((await stat(secretPath)).mode & 0o777).toBe(0o600);

      // Guidance points at the file, not the value.
      expect(result.guidance.join('\n')).toContain(secretPath);
    });

    it('writes no secret file when the caller supplies the secret', async () => {
      const result = (await call('webhook_create', {
        name: 'byo-secret',
        prompt: 'x',
        verification: { type: 'bearer', secret: 'user-supplied-secret' },
      })) as { generatedSecret: unknown };
      expect(result.generatedSecret).toBeNull();
      await expect(stat(path.join(secretsDir, 'byo-secret.secret'))).rejects.toThrow();
    });

    it('HMAC verification works end-to-end with the out-of-band secret', async () => {
      const result = (await call('webhook_create', {
        name: 'hmac-e2e',
        prompt: 'x',
        verification: { type: 'hmac', signatureHeader: 'x-signature', prefix: 'sha256=' },
      })) as { generatedSecret: { path: string } };
      const secret = (await readFile(result.generatedSecret.path, 'utf8')).trim();

      const trigger = await store.getByName('hmac-e2e');
      const body = Buffer.from('{"hello":"world"}', 'utf8');
      const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      expect(
        verifyDelivery({
          verification: trigger!.verification,
          headers: { 'x-signature': sig },
          body,
        }),
      ).toEqual({ ok: true });
      expect(
        verifyDelivery({
          verification: trigger!.verification,
          headers: { 'x-signature': 'sha256=deadbeef' },
          body,
        }).ok,
      ).toBe(false);
    });

    it('webhook_list and webhook_create echo no stored secret values', async () => {
      await call('webhook_create', {
        name: 'leakcheck',
        prompt: 'x',
        verification: { type: 'bearer', secret: 'super-secret-token-42' },
      });
      const listed = await call('webhook_list', {});
      expect(JSON.stringify(listed)).not.toContain('super-secret-token-42');
    });

    it('webhook_delete removes the secret pickup file', async () => {
      const created = (await call('webhook_create', {
        name: 'cleanup',
        prompt: 'x',
        verification: { type: 'bearer' },
      })) as { trigger: { id: string }; generatedSecret: { path: string } };
      await expect(stat(created.generatedSecret.path)).resolves.toBeTruthy();
      const deleted = (await call('webhook_delete', { id: created.trigger.id })) as {
        deleted: boolean;
      };
      expect(deleted.deleted).toBe(true);
      await expect(stat(created.generatedSecret.path)).rejects.toThrow();
    });
  });

  describe('webhook_create security warning', () => {
    it('flags verification:none + empty allowedTools (open prompt-injection with full tools)', async () => {
      const result = (await call('webhook_create', {
        name: 'wide-open',
        prompt: 'do: {body}',
        verification: { type: 'none' },
      })) as { securityWarning?: string; guidance: string[] };
      expect(result.securityWarning).toMatch(/HIGH RISK/);
      expect(result.guidance.join('\n')).toContain('HIGH RISK');
    });

    it('does not flag a verification:none trigger that restricts allowedTools', async () => {
      const result = (await call('webhook_create', {
        name: 'scoped-open',
        prompt: 'do: {body}',
        allowedTools: ['read_file'],
        verification: { type: 'none' },
      })) as { securityWarning?: string };
      expect(result.securityWarning).toBeUndefined();
    });

    it('does not flag an authenticated trigger even with empty allowedTools', async () => {
      const result = (await call('webhook_create', {
        name: 'authed-wide',
        prompt: 'do: {body}',
        verification: { type: 'bearer', secret: 'a-strong-secret-here' },
      })) as { securityWarning?: string };
      expect(result.securityWarning).toBeUndefined();
    });
  });

  describe('webhook_test honors filters', () => {
    let fireCalls: number;

    beforeEach(() => {
      fireCalls = 0;
      const dispatcher = {
        fire: async () => {
          fireCalls += 1;
          return { ok: true, text: 'fired', inboxPath: '/tmp/inbox/x.md' };
        },
      } as unknown as WebhookDispatcher;
      // Re-wire the tools with a fire-counting dispatcher (overrides beforeEach).
      tools = buildWebhookTools({
        store,
        config,
        dispatcher,
        tunnelHandle: { current: null },
        secretsDir,
      });
    });

    it('does NOT fire when the synthetic delivery is filtered out (matches live path)', async () => {
      const created = (await call('webhook_create', {
        name: 'only-opened',
        prompt: 'Handle: {body_json}',
        verification: { type: 'none' },
        filters: {
          include: [{ source: 'jsonPath', path: 'action', equals: ['opened'] }],
          exclude: [],
        },
      })) as { trigger: { id: string } };

      const result = (await call('webhook_test', {
        id: created.trigger.id,
        body: JSON.stringify({ action: 'closed' }),
      })) as { ok: boolean; filtered: boolean; fired: boolean };

      expect(result.ok).toBe(true);
      expect(result.filtered).toBe(true);
      expect(result.fired).toBe(false);
      // Critical: the dispatcher must NOT have been invoked — otherwise the test
      // tool reports a false positive for a trigger that never fires in prod.
      expect(fireCalls).toBe(0);
    });

    it('fires when the synthetic delivery passes the filters', async () => {
      const created = (await call('webhook_create', {
        name: 'only-opened-2',
        prompt: 'Handle: {body_json}',
        verification: { type: 'none' },
        filters: {
          include: [{ source: 'jsonPath', path: 'action', equals: ['opened'] }],
          exclude: [],
        },
      })) as { trigger: { id: string } };

      const result = (await call('webhook_test', {
        id: created.trigger.id,
        body: JSON.stringify({ action: 'opened' }),
      })) as { ok: boolean; filtered: boolean; fired: boolean };

      expect(result.filtered).toBe(false);
      expect(result.fired).toBe(true);
      expect(fireCalls).toBe(1);
    });

    it('rejects an unknown id without firing', async () => {
      await expect(call('webhook_test', { id: 'nope' })).rejects.toThrow(/no trigger/);
      expect(fireCalls).toBe(0);
    });
  });

  describe('webhook_status exposure warning', () => {
    it('flags a non-loopback bind with an enabled verification:none trigger', async () => {
      await config.set({ host: '0.0.0.0' });
      await call('webhook_create', {
        name: 'open-trigger',
        prompt: 'x',
        verification: { type: 'none' },
      });
      const status = (await call('webhook_status', {})) as {
        listener: { loopback: boolean };
        exposureWarning?: string;
      };
      expect(status.listener.loopback).toBe(false);
      expect(status.exposureWarning).toMatch(/CRITICAL/);
      expect(status.exposureWarning).toContain('open-trigger');
    });

    it('does not flag exposure on the default loopback bind', async () => {
      await call('webhook_create', {
        name: 'open-but-local',
        prompt: 'x',
        verification: { type: 'none' },
      });
      const status = (await call('webhook_status', {})) as {
        listener: { loopback: boolean };
        exposureWarning?: string;
      };
      expect(status.listener.loopback).toBe(true);
      expect(status.exposureWarning).toBeUndefined();
    });

    it('downgrades to an informational note on a non-loopback bind with only authed triggers', async () => {
      await config.set({ host: '0.0.0.0' });
      await call('webhook_create', {
        name: 'authed-trigger',
        prompt: 'x',
        verification: { type: 'bearer', secret: 'a-strong-secret-here' },
      });
      const status = (await call('webhook_status', {})) as { exposureWarning?: string };
      expect(status.exposureWarning).toBeDefined();
      expect(status.exposureWarning).not.toMatch(/CRITICAL/);
    });
  });

  describe('store corruption surfacing', () => {
    it('webhook_list and webhook_create report a storeWarning after a corrupt load', async () => {
      await writeFile(path.join(dir, 'webhooks.json'), 'not json at all', 'utf8');
      const listed = (await call('webhook_list', {})) as { storeWarning?: string };
      expect(listed.storeWarning).toMatch(/preserved/);

      const created = (await call('webhook_create', {
        name: 'post-corruption',
        prompt: 'x',
        verification: { type: 'none' },
      })) as { storeWarning?: string };
      expect(created.storeWarning).toMatch(/\.corrupt-/);
    });

    it('reports no storeWarning on a healthy store', async () => {
      const listed = (await call('webhook_list', {})) as { storeWarning?: string };
      expect(listed.storeWarning).toBeUndefined();
    });
  });
});

describe('webhook target session (ownerSessionId routing)', () => {
  let dir: string;
  let store: WebhookStore;
  let tools: ReadonlyArray<ToolDef>;

  const call = async (name: string, input: unknown): Promise<unknown> => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return t.handler(t.inputSchema.parse(input), ctx);
  };

  const build = (ownerSessionId?: string): void => {
    tools = buildWebhookTools({
      store,
      config: new WebhookConfigStore({ file: path.join(dir, 'webhooks-config.json') }),
      dispatcher: { fire: async () => ({ ok: true, text: '' }) } as unknown as WebhookDispatcher,
      tunnelHandle: { current: null },
      secretsDir: path.join(dir, 'secrets'),
      ...(ownerSessionId ? { ownerSessionId } : {}),
    });
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-webhook-target-'));
    store = new WebhookStore({ file: path.join(dir, 'webhooks.json') });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stamps ownerSessionId from an explicit targetSessionId', async () => {
    build();
    const created = (await call('webhook_create', {
      name: 'pinned',
      prompt: 'x',
      verification: { type: 'none' },
      targetSessionId: 'desk-B',
    })) as { trigger: { id: string } };
    expect((await store.get(created.trigger.id))?.ownerSessionId).toBe('desk-B');
  });

  it('targetSessionId overrides the creating runner', async () => {
    build('creator-session');
    const created = (await call('webhook_create', {
      name: 'override',
      prompt: 'x',
      verification: { type: 'none' },
      targetSessionId: 'desk-B',
    })) as { trigger: { id: string } };
    expect((await store.get(created.trigger.id))?.ownerSessionId).toBe('desk-B');
  });

  it('defaults to the creating runner when no targetSessionId is given', async () => {
    build('creator-session');
    const created = (await call('webhook_create', {
      name: 'default-owner',
      prompt: 'x',
      verification: { type: 'none' },
    })) as { trigger: { id: string } };
    expect((await store.get(created.trigger.id))?.ownerSessionId).toBe('creator-session');
  });

  it('webhook_update reassigns the target session', async () => {
    build('creator-session');
    const created = (await call('webhook_create', {
      name: 'movable',
      prompt: 'x',
      verification: { type: 'none' },
    })) as { trigger: { id: string } };
    await call('webhook_update', { id: created.trigger.id, targetSessionId: 'desk-C' });
    expect((await store.get(created.trigger.id))?.ownerSessionId).toBe('desk-C');
  });
});
