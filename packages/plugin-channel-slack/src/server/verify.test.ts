import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SLACK_REPLAY_WINDOW_SEC, verifySlackSignature } from './verify.js';

const SECRET = 'slack_signing_secret_abcdef0123456789';

/** Build the headers Slack would send for `body` at epoch-seconds `ts`. */
function sign(body: string, ts: number, secret = SECRET): Record<string, string> {
  const base = `v0:${ts}:${body}`;
  const sig = `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
  return {
    'x-slack-request-timestamp': String(ts),
    'x-slack-signature': sig,
  };
}

describe('verifySlackSignature', () => {
  it('accepts a correctly signed request', () => {
    const body = '{"type":"event_callback"}';
    const ts = Math.floor(Date.now() / 1000);
    const res = verifySlackSignature({
      rawBody: Buffer.from(body),
      headers: sign(body, ts),
      signingSecret: SECRET,
      nowMs: Date.now(),
    });
    expect(res.ok).toBe(true);
  });

  it('verifies over the RAW bytes (a reserialized body fails)', () => {
    // The signature is computed over the exact bytes; a body whose JSON has been
    // reserialized (different whitespace) must not verify.
    const rawBody = '{"a":1,"b":2}';
    const ts = Math.floor(Date.now() / 1000);
    const headers = sign(rawBody, ts);
    const reserialized = JSON.stringify(JSON.parse(rawBody)); // identical here, so tweak spacing
    const tweaked = '{ "a": 1, "b": 2 }';
    expect(reserialized).not.toBe(tweaked);
    const res = verifySlackSignature({
      rawBody: Buffer.from(tweaked),
      headers,
      signingSecret: SECRET,
      nowMs: Date.now(),
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a wrong signature', () => {
    const body = '{"x":1}';
    const ts = Math.floor(Date.now() / 1000);
    const headers = sign(body, ts);
    headers['x-slack-signature'] = 'v0=deadbeef';
    const res = verifySlackSignature({
      rawBody: Buffer.from(body),
      headers,
      signingSecret: SECRET,
      nowMs: Date.now(),
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a request signed with a different secret', () => {
    const body = '{"x":1}';
    const ts = Math.floor(Date.now() / 1000);
    const headers = sign(body, ts, 'a-different-secret-entirely');
    const res = verifySlackSignature({
      rawBody: Buffer.from(body),
      headers,
      signingSecret: SECRET,
      nowMs: Date.now(),
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a request outside the 5-minute replay window', () => {
    const body = '{"x":1}';
    const now = Date.now();
    const oldTs = Math.floor(now / 1000) - (SLACK_REPLAY_WINDOW_SEC + 10);
    const res = verifySlackSignature({
      rawBody: Buffer.from(body),
      headers: sign(body, oldTs),
      signingSecret: SECRET,
      nowMs: now,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/replay window/);
  });

  it('accepts a request at the edge of the replay window', () => {
    const body = '{"x":1}';
    const now = Date.now();
    const edgeTs = Math.floor(now / 1000) - (SLACK_REPLAY_WINDOW_SEC - 5);
    const res = verifySlackSignature({
      rawBody: Buffer.from(body),
      headers: sign(body, edgeTs),
      signingSecret: SECRET,
      nowMs: now,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects when headers are missing', () => {
    const res = verifySlackSignature({
      rawBody: Buffer.from('{}'),
      headers: {},
      signingSecret: SECRET,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    const body = '{}';
    const headers = sign(body, Math.floor(Date.now() / 1000));
    headers['x-slack-request-timestamp'] = 'not-a-number';
    const res = verifySlackSignature({
      rawBody: Buffer.from(body),
      headers,
      signingSecret: SECRET,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects when no signing secret is configured', () => {
    const body = '{}';
    const res = verifySlackSignature({
      rawBody: Buffer.from(body),
      headers: sign(body, Math.floor(Date.now() / 1000)),
      signingSecret: '',
    });
    expect(res.ok).toBe(false);
  });
});
