import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebhookDispatcher, type WebhookFireOutcome } from './runner.js';
import { WebhookServer } from './server.js';
import { WebhookStore, type WebhookTrigger } from './store.js';

interface FiredCall {
  readonly trigger: WebhookTrigger;
  readonly outcome: WebhookFireOutcome;
}

function pickPort(): number {
  // Ephemeral range; rerunning the suite in parallel won't collide because
  // OS-assigned bind happens via 0, but we want a deterministic test path.
  // Using 0 lets the OS pick — we read the bound port off the server.
  return 0;
}

describe('WebhookServer', () => {
  let dir: string;
  let store: WebhookStore;
  let server: WebhookServer;
  let port: number;
  let fired: FiredCall[];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-wh-server-'));
    store = new WebhookStore({ file: path.join(dir, 'webhooks.json') });
    fired = [];
    const dispatcher = new WebhookDispatcher({
      store,
      runner: {
        runPrompt: async ({ prompt, triggerName }) => ({
          text: `handled ${triggerName}: ${prompt.slice(0, 30)}`,
        }),
      },
      inbox: { dir: path.join(dir, 'inbox') },
      onFired: (trigger, outcome) => {
        fired.push({ trigger, outcome });
      },
    });
    server = new WebhookServer({
      host: '127.0.0.1',
      port: pickPort(),
      store,
      dispatcher,
    });
    const handle = await server.start();
    port = handle.port;
  });

  afterEach(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  // Note: server.start() with port=0 picks an OS-assigned port. The
  // handle.port we return is the requested value (0), not the actual
  // bound one. Tests below skip the network round-trip and instead
  // verify behavior via the store + dispatcher contract, which is the
  // interesting behavior anyway. Full e2e network tests live in
  // integration/.
  it('returns 200 on /health', async () => {
    // Bind to a real ephemeral port so we can hit the listener.
    await server.stop();
    server = new WebhookServer({
      host: '127.0.0.1',
      port: 0,
      store,
      dispatcher: new WebhookDispatcher({
        store,
        runner: { runPrompt: async () => ({ text: '' }) },
        inbox: { dir: path.join(dir, 'inbox') },
      }),
    });
    await server.start();
    const address = (server as unknown as { server: { address(): { port: number } } })
      .server.address();
    const res = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('rejects unknown triggers with 404', async () => {
    await server.stop();
    server = new WebhookServer({
      host: '127.0.0.1',
      port: 0,
      store,
      dispatcher: new WebhookDispatcher({
        store,
        runner: { runPrompt: async () => ({ text: '' }) },
        inbox: { dir: path.join(dir, 'inbox') },
      }),
    });
    await server.start();
    const address = (server as unknown as { server: { address(): { port: number } } })
      .server.address();
    const res = await fetch(`http://127.0.0.1:${address.port}/webhook/does-not-exist`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('accepts a verified HMAC delivery and fires the dispatcher', async () => {
    const secret = 'super-secret-1234';
    const created = await store.create({
      name: 'gh-issues',
      prompt: 'New event: {header.x-event}',
      allowedTools: [],
      verification: {
        type: 'hmac',
        secret,
        signatureHeader: 'x-hub-signature-256',
        algorithm: 'sha256',
        prefix: 'sha256=',
        scheme: 'plain',
        timestampToleranceSec: 300,
      },
    });

    await server.stop();
    server = new WebhookServer({
      host: '127.0.0.1',
      port: 0,
      store,
      dispatcher: new WebhookDispatcher({
        store,
        runner: {
          runPrompt: async ({ prompt }) => ({ text: `ran with prompt: ${prompt}` }),
        },
        inbox: { dir: path.join(dir, 'inbox') },
        onFired: (trigger, outcome) => fired.push({ trigger, outcome }),
      }),
    });
    await server.start();
    const address = (server as unknown as { server: { address(): { port: number } } })
      .server.address();
    port = address.port;

    const body = '{"hello":"world"}';
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const res = await fetch(`http://127.0.0.1:${port}/webhook/${created.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig, 'x-event': 'issues' },
      body,
    });
    expect(res.status).toBe(202);
    // Give the fire-and-forget dispatcher a moment to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(fired).toHaveLength(1);
    expect(fired[0]!.outcome.ok).toBe(true);
    expect(fired[0]!.outcome.text).toContain('ran with prompt: New event: issues');
  });

  it('rejects a bad HMAC with 401 and does not fire', async () => {
    const created = await store.create({
      name: 'gh-issues-2',
      prompt: 'x',
      allowedTools: [],
      verification: {
        type: 'hmac',
        secret: 'real-secret-1234',
        signatureHeader: 'x-hub-signature-256',
        algorithm: 'sha256',
        prefix: 'sha256=',
        scheme: 'plain',
        timestampToleranceSec: 300,
      },
    });

    await server.stop();
    server = new WebhookServer({
      host: '127.0.0.1',
      port: 0,
      store,
      dispatcher: new WebhookDispatcher({
        store,
        runner: { runPrompt: async () => ({ text: 'should not be called' }) },
        inbox: { dir: path.join(dir, 'inbox') },
        onFired: (trigger, outcome) => fired.push({ trigger, outcome }),
      }),
    });
    await server.start();
    const address = (server as unknown as { server: { address(): { port: number } } })
      .server.address();
    port = address.port;

    const res = await fetch(`http://127.0.0.1:${port}/webhook/${created.id}`, {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toHaveLength(0);
  });
});
