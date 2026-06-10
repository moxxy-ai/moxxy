/**
 * End-to-end test of the standalone Virtual Office CHANNEL: the channel boots
 * its own HTTP+SSE server on an ephemeral port, then real HTTP requests drive
 * the office surface via fetch. This proves the office runs entirely on its own
 * server — no generic HTTP channel, no core seam — and is its own security
 * boundary: it bearer-auths every route, zod-validates its bodies, caps the
 * agent-run/image path, and drops `sensitive` envelopes off the SSE stream.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { defineProvider, definePlugin } from '@moxxy/sdk';
import { FakeProvider, textReply } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { VirtualOfficeChannel } from './channel.js';
import { handleEvents, type OfficeRequestContext } from './routes.js';
import { OfficeAgentRuntime } from './office-agent-runtime.js';
import type { VirtualOfficeEnvelope } from './virtual-office-events.js';
import type { ChannelHandle } from '@moxxy/sdk';

const TOKEN = 'office-token-123';

function buildSession(): Session {
  const provider = new FakeProvider({ script: [textReply('office agent did the work')] });
  const session = new Session({
    cwd: process.cwd(),
    logger: silentLogger,
    permissionResolver: autoAllowResolver,
  });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'office-channel-shim',
      providers: [
        defineProvider({
          name: provider.name,
          models: [...provider.models],
          createClient: () => provider,
        }),
      ],
    }),
  );
  session.providers.setActive(provider.name);
  session.pluginHost.registerStatic(builtinToolsPlugin);
  session.pluginHost.registerStatic(defaultModePlugin);
  return session;
}

describe('Virtual Office standalone channel', () => {
  let channel: VirtualOfficeChannel;
  let handle: ChannelHandle;
  let baseUrl: string;

  beforeEach(async () => {
    channel = new VirtualOfficeChannel({ port: 0, authToken: TOKEN });
    handle = await channel.start({ session: buildSession() });
    baseUrl = `http://127.0.0.1:${channel.boundPort}`;
  });

  afterEach(async () => {
    await handle.stop();
  });

  function auth(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${TOKEN}`, ...extra };
  }

  it('binds an ephemeral port and answers health unauthenticated', async () => {
    expect(channel.boundPort).toBeGreaterThan(0);
    const res = await fetch(`${baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).listener).toBe('virtual-office');
  });

  it('rejects office routes without a Bearer token (401) — auth enforced by the channel', async () => {
    const res = await fetch(`${baseUrl}/v1/agents`);
    expect(res.status).toBe(401);
  });

  it('GET /v1/agents lists the live session agent', async () => {
    const res = await fetch(`${baseUrl}/v1/agents`, { headers: auth() });
    expect(res.status).toBe(200);
    const agents = (await res.json()) as Array<{ id: string }>;
    expect(agents[0]?.id).toBe('session');
  });

  it('creates an agent, runs it via the FakeProvider, surfaces SSE envelopes, then dismisses into the graveyard', async () => {
    const controller = new AbortController();
    const sse = await fetch(`${baseUrl}/v1/events/stream`, { headers: auth(), signal: controller.signal });
    expect(sse.status).toBe(200);
    expect(sse.headers.get('content-type')).toContain('text/event-stream');
    const reader = sse.body!.getReader();
    const decoder = new TextDecoder();
    const seen: Array<{ event_type: string; agent_id: string }> = [];
    const pump = (async () => {
      try {
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              seen.push(JSON.parse(line.slice(6)));
            } catch {
              /* skip non-JSON frames (e.g. ': connected') */
            }
          }
        }
      } catch {
        /* aborted */
      }
    })();

    const created = await fetch(`${baseUrl}/v1/agents`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'researcher' }),
    });
    expect(created.status).toBe(200);
    const agent = (await created.json()) as { id: string; kind: string };
    expect(agent.kind).toBe('office_agent');

    const run = await fetch(`${baseUrl}/v1/agents/${agent.id}/runs`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ task: 'do the research' }),
    });
    expect(run.status).toBe(200);
    expect((await run.json()).status).toBe('running');

    const start = Date.now();
    while (!seen.some((e) => e.event_type === 'run.completed' && e.agent_id === agent.id)) {
      if (Date.now() - start > 2000) throw new Error('timed out waiting for run.completed envelope');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(seen.some((e) => e.event_type === 'message.final' && e.agent_id === agent.id)).toBe(true);

    controller.abort();
    await pump;

    const dismissed = await fetch(`${baseUrl}/v1/agents/${agent.id}`, { method: 'DELETE', headers: auth() });
    expect(dismissed.status).toBe(200);

    const grave = await fetch(`${baseUrl}/v1/graveyard`, { headers: auth() });
    const entries = (await grave.json()) as Array<{ agentId: string; outcome: string }>;
    expect(entries.some((e) => e.agentId === agent.id)).toBe(true);

    const after = await fetch(`${baseUrl}/v1/agents`, { headers: auth() });
    const ids = ((await after.json()) as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual(['session']);
  });

  it('rejects a malformed agent-run body (400 from the office zod schema)', async () => {
    const created = await fetch(`${baseUrl}/v1/agents`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'x' }),
    });
    const agent = (await created.json()) as { id: string };
    const res = await fetch(`${baseUrl}/v1/agents/${agent.id}/runs`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ notTask: 1 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad_request');
  });

  it('rejects an oversized image attachment (400)', async () => {
    const created = await fetch(`${baseUrl}/v1/agents`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'vision' }),
    });
    const agent = (await created.json()) as { id: string };
    // 11 MB of base64 'A' decodes to > 10 MB — past the per-image cap but well
    // under the run body cap, so this exercises the schema's size refinement.
    const oversized = 'A'.repeat(11 * 1024 * 1024 + 16);
    const res = await fetch(`${baseUrl}/v1/agents/${agent.id}/runs`, {
      method: 'POST',
      headers: auth({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        task: 'inspect',
        attachments: [{ kind: 'image', content: oversized, mediaType: 'image/png' }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('404s unknown routes (behind auth)', async () => {
    const res = await fetch(`${baseUrl}/v1/does-not-exist`, { headers: auth() });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('tears down the server on stop()', async () => {
    const port = channel.boundPort;
    await handle.stop();
    await expect(fetch(`http://127.0.0.1:${port}/v1/health`)).rejects.toThrow();
    // start a fresh one for the afterEach teardown to no-op cleanly
    channel = new VirtualOfficeChannel({ port: 0, authToken: TOKEN });
    handle = await channel.start({ session: buildSession() });
  });
});

describe('Virtual Office interactive permissions', () => {
  it('404s the decision endpoint when interactive permissions are off', async () => {
    const channel = new VirtualOfficeChannel({ port: 0, authToken: TOKEN });
    const handle = await channel.start({ session: buildSession() });
    try {
      const res = await fetch(`http://127.0.0.1:${channel.boundPort}/v1/permissions/perm-1/decision`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'allow' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await handle.stop();
    }
  });

  it('installs the interactive broker as the channel resolver when enabled', async () => {
    const channel = new VirtualOfficeChannel({ port: 0, authToken: TOKEN, interactivePermissions: true });
    const handle = await channel.start({ session: buildSession() });
    try {
      expect(channel.permissionResolver.name).toBe('http-interactive');
      // An unknown request id resolves to 404 (broker has no such pending request).
      const res = await fetch(`http://127.0.0.1:${channel.boundPort}/v1/permissions/perm-x/decision`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'allow' }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('not_found');
    } finally {
      await handle.stop();
    }
  });
});

describe('Virtual Office SSE timeline sensitivity', () => {
  it('drops envelopes flagged sensitive and never leaks their payload', async () => {
    const session = buildSession();
    const runtime = new OfficeAgentRuntime(session, silentLogger);

    // A minimal fake OfficeRequestContext whose openEventStream records sends.
    const sent: string[] = [];
    let closeResolve: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => {
      closeResolve = resolve;
    });
    const ctx = {
      session,
      runtime,
      broker: null,
      req: {} as IncomingMessage,
      res: {} as ServerResponse,
      pathname: '/v1/events/stream',
      pathSegment: () => '',
      readBody: async () => '',
      reply: () => undefined,
      openEventStream: () => ({
        send: (data: unknown) => {
          sent.push(JSON.stringify(data));
        },
        closed,
      }),
      logger: silentLogger,
    } as unknown as OfficeRequestContext;

    const done = handleEvents(ctx, runtime, silentLogger);
    await new Promise((r) => setTimeout(r, 5));

    const secret = 'SUPER-SECRET-TOKEN-do-not-leak';
    const publicEnvelope: VirtualOfficeEnvelope = {
      agent_id: 'session',
      run_id: null,
      parent_run_id: null,
      sequence: 1,
      event_type: 'office_agent.created',
      payload: { hello: 'world' },
      sensitive: false,
    };
    const sensitiveEnvelope: VirtualOfficeEnvelope = {
      agent_id: 'session',
      run_id: null,
      parent_run_id: null,
      sequence: 2,
      event_type: 'secret.leak',
      payload: { token: secret },
      sensitive: true,
    };
    (runtime as unknown as { emit: (e: VirtualOfficeEnvelope) => void }).emit(publicEnvelope);
    (runtime as unknown as { emit: (e: VirtualOfficeEnvelope) => void }).emit(sensitiveEnvelope);

    closeResolve?.();
    await done;

    const body = sent.join('\n');
    expect(body).toContain('office_agent.created');
    expect(body).not.toContain(secret);
    expect(body).not.toContain('secret.leak');
  });
});
