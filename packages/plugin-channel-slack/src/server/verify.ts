import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Slack request-signature verification.
 *
 * Slack signs each request with HMAC-SHA256 over the string
 * `v0:{X-Slack-Request-Timestamp}:{rawBody}`, hex-encoded and prefixed `v0=`,
 * delivered in the `X-Slack-Signature` header. This is structurally identical
 * to the Stripe HMAC scheme in `@moxxy/plugin-webhooks/src/verify.ts` — a
 * timestamped HMAC over the raw bytes with a replay window — so the logic here
 * mirrors it: verify over the EXACT raw body bytes (never the reserialized
 * JSON), constant-time compare, and reject deliveries outside a ±5-minute
 * window to bound replay.
 *
 * Always returns a structured verdict; the caller decides whether to log the
 * reason (useful in dev) or hide it (preferable on a public endpoint).
 *
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */

/** Slack's documented replay window: reject requests older than 5 minutes. */
export const SLACK_REPLAY_WINDOW_SEC = 60 * 5;

export type SlackVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function lower(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Constant-time compare of two `v0=…` hex signatures. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export interface VerifySlackSignatureInput {
  readonly rawBody: Buffer;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly signingSecret: string;
  /** Epoch-ms used to enforce the replay window. Defaults to `Date.now()`. */
  readonly nowMs?: number;
}

/**
 * Verify a Slack request signature against the raw body. Pass the EXACT bytes
 * read off the socket, BEFORE `JSON.parse` — reserializing the body changes
 * whitespace/key-order and breaks the HMAC.
 */
export function verifySlackSignature(input: VerifySlackSignatureInput): SlackVerifyResult {
  const { rawBody, headers, signingSecret } = input;
  if (!signingSecret) return { ok: false, reason: 'no signing secret configured' };

  const timestamp = lower(headers, 'x-slack-request-timestamp');
  const signature = lower(headers, 'x-slack-signature');
  if (!timestamp) return { ok: false, reason: 'missing X-Slack-Request-Timestamp' };
  if (!signature) return { ok: false, reason: 'missing X-Slack-Signature' };

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'non-numeric timestamp' };

  const now = input.nowMs ?? Date.now();
  const driftSec = Math.abs(now / 1000 - tsNum);
  if (driftSec > SLACK_REPLAY_WINDOW_SEC) {
    return { ok: false, reason: `timestamp drift ${Math.round(driftSec)}s exceeds replay window` };
  }

  // HMAC over `v0:{ts}:{rawBody}` — note the raw bytes, not a reserialized JSON.
  const base = Buffer.concat([
    Buffer.from(`v0:${timestamp}:`, 'utf8'),
    rawBody,
  ]);
  const computed = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`;
  if (safeEqual(computed, signature)) return { ok: true };
  return { ok: false, reason: 'signature mismatch' };
}
