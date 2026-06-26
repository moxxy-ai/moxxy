import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { IngestServer, SLACK_EVENTS_PATH, type DispatchContext } from './ingest-server.js';
import type { IngestServerHooks } from './ingest-server.js';
import type { SlackEventCallback } from './schema.js';

const SECRET = 'test-signing-secret-0123456789abcdef';
const BOT_USER = 'UBOT';

function sign(body: string, ts = Math.floor(Date.now() / 1000)): Record<string, string> {
  const sig = `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex')}`;
  return { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sig };
}

interface Harness {
  server: IngestServer;
  url: string;
  dispatched: DispatchContext[];
  verified: SlackEventCallback[];
  authorized: { teamId?: string; channel?: string } | null;
  pairConsumes: boolean;
  stop(): Promise<void>;
}

async function makeServer(over: Partial<IngestServerHooks> = {}): Promise<Harness> {
  const dispatched: DispatchContext[] = [];
  const verified: SlackEventCallback[] = [];
  const state: { authorized: { teamId?: string; channel?: string } | null; pairConsumes: boolean } =
    { authorized: { teamId: 'T1', channel: 'C1' }, pairConsumes: false };

  const hooks: IngestServerHooks = {
    botUserId: BOT_USER,
    isAuthorized: (teamId, channel) =>
      state.authorized != null &&
      state.authorized.teamId === teamId &&
      (state.authorized.channel === undefined || state.authorized.channel === channel),
    onVerifiedEvent: (ev) => {
      verified.push(ev);
      return state.pairConsumes;
    },
    dispatch: (ctx) => dispatched.push(ctx),
    ...over,
  };

  const server = new IngestServer({ signingSecret: SECRET, hooks });
  const bound = await server.start();
  const url = `http://${bound.host}:${bound.port}${SLACK_EVENTS_PATH}`;
  return {
    server,
    url,
    dispatched,
    verified,
    get authorized() {
      return state.authorized;
    },
    set authorized(v) {
      state.authorized = v;
    },
    get pairConsumes() {
      return state.pairConsumes;
    },
    set pairConsumes(v) {
      state.pairConsumes = v;
    },
    stop: () => server.stop(),
  } as Harness;
}

function appMention(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    type: 'event_callback',
    team_id: 'T1',
    event_id: 'Ev1',
    event: {
      type: 'app_mention',
      user: 'U1',
      text: '<@UBOT> hi',
      channel: 'C1',
      ts: '1700000000.000100',
      ...over,
    },
  });
}

async function post(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

describe('IngestServer', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.stop();
  });

  it('rejects an unsigned request with 401 (before the session)', async () => {
    h = await makeServer();
    const body = appMention();
    const res = await post(h.url, body, {}); // no signature headers
    expect(res.status).toBe(401);
    expect(h.dispatched).toHaveLength(0);
  });

  it('rejects a tampered body with 401', async () => {
    h = await makeServer();
    const body = appMention();
    const headers = sign(body);
    const res = await post(h.url, appMention({ text: 'tampered' }), headers);
    expect(res.status).toBe(401);
    expect(h.dispatched).toHaveLength(0);
  });

  it('answers the url_verification challenge', async () => {
    h = await makeServer();
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const res = await post(h.url, body, sign(body));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ challenge: 'abc123' });
    expect(h.dispatched).toHaveLength(0);
  });

  it('rejects a signed-but-malformed envelope with 400', async () => {
    h = await makeServer();
    const body = JSON.stringify({ type: 'event_callback' /* no event */ });
    const res = await post(h.url, body, sign(body));
    expect(res.status).toBe(400);
    expect(h.dispatched).toHaveLength(0);
  });

  it('acks 200 and dispatches an authorized app_mention', async () => {
    h = await makeServer();
    const body = appMention();
    const res = await post(h.url, body, sign(body));
    expect(res.status).toBe(200);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toMatchObject({ channel: 'C1', text: '<@UBOT> hi', teamId: 'T1' });
    // thread_ts falls back to ts when absent.
    expect(h.dispatched[0]?.threadTs).toBe('1700000000.000100');
  });

  it('threads under thread_ts when present', async () => {
    h = await makeServer();
    const body = appMention({ thread_ts: '1699999999.000001' });
    await post(h.url, body, sign(body));
    expect(h.dispatched[0]?.threadTs).toBe('1699999999.000001');
  });

  it('drops a duplicate event_id (acks 200, does not re-dispatch)', async () => {
    h = await makeServer();
    const body = appMention();
    const headers = sign(body);
    const first = await post(h.url, body, headers);
    const second = await post(h.url, body, sign(body));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.dispatched).toHaveLength(1);
  });

  it('drops a Slack retry (X-Slack-Retry-Num) without dispatching', async () => {
    h = await makeServer();
    const body = appMention({ ts: '1700000000.999' });
    const headers = { ...sign(body), 'x-slack-retry-num': '1' };
    const res = await post(h.url, body, headers);
    expect(res.status).toBe(200);
    expect(h.dispatched).toHaveLength(0);
  });

  it("drops the bot's own message (bot_id / matching user)", async () => {
    h = await makeServer();
    const byBotId = appMention({ bot_id: 'B1', event_id: 'EvB1' });
    await post(h.url, byBotId, sign(byBotId));
    const byUser = appMention({ user: BOT_USER, event_id: 'EvB2' });
    await post(h.url, byUser, sign(byUser));
    expect(h.dispatched).toHaveLength(0);
  });

  it('drops an event from an unauthorized team/channel', async () => {
    h = await makeServer();
    h.authorized = { teamId: 'T-OTHER', channel: 'C-OTHER' };
    const body = appMention();
    const res = await post(h.url, body, sign(body));
    expect(res.status).toBe(200);
    expect(h.dispatched).toHaveLength(0);
  });

  it('lets the pairing hook consume the first verified event (no dispatch)', async () => {
    h = await makeServer();
    h.authorized = null; // not yet paired
    h.pairConsumes = true;
    const body = appMention();
    const res = await post(h.url, body, sign(body));
    expect(res.status).toBe(200);
    expect(h.verified).toHaveLength(1);
    expect(h.dispatched).toHaveLength(0);
  });

  it('ignores message events with an edit/system subtype', async () => {
    h = await makeServer();
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'EvSub',
      event: {
        type: 'message',
        subtype: 'message_changed',
        channel: 'C1',
        text: 'edited',
        ts: '1700000000.1',
      },
    });
    const res = await post(h.url, body, sign(body));
    expect(res.status).toBe(200);
    expect(h.dispatched).toHaveLength(0);
  });

  it('rejects an oversized body without ever dispatching', async () => {
    const dispatched: DispatchContext[] = [];
    const server = new IngestServer({
      signingSecret: SECRET,
      maxBodyBytes: 64,
      hooks: {
        botUserId: BOT_USER,
        isAuthorized: () => true,
        dispatch: (c) => dispatched.push(c),
      },
    });
    const bound = await server.start();
    const url = `http://${bound.host}:${bound.port}${SLACK_EVENTS_PATH}`;
    const big = 'x'.repeat(500);
    const body = JSON.stringify({ type: 'event_callback', big });
    // readRequestBody destroys the socket once the cap is exceeded, so the
    // client either sees a 413 or a dropped connection — both are acceptable
    // "rejected, never reached the session" outcomes. What MUST hold is that
    // the oversized body never drives a turn.
    let status = 0;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...sign(body) },
        body,
      });
      status = res.status;
    } catch {
      status = -1; // connection dropped by the size-cap socket destroy
    }
    expect([413, -1]).toContain(status);
    expect(dispatched).toHaveLength(0);
    await server.stop();
    // Reassign h so afterEach's stop() is a no-op on an already-stopped server.
    h = { stop: async () => {} } as Harness;
  });

  it('a handler error never escalates (returns 404/4xx for junk)', async () => {
    h = await makeServer();
    // GET on the events path is a 404, not a thrown error.
    const res = await fetch(h.url, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('serves a health probe', async () => {
    h = await makeServer();
    const base = h.url.replace(SLACK_EVENTS_PATH, '/slack/health');
    const res = await fetch(base, { method: 'GET' });
    expect(res.status).toBe(200);
  });
});
