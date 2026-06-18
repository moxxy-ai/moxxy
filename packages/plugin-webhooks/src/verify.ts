import { createHmac, timingSafeEqual } from 'node:crypto';
import { bearerTokenMatches } from '@moxxy/sdk/server';
import type { WebhookTrigger, WebhookVerification } from './store.js';

/**
 * Request verification for webhook deliveries.
 *
 * Three schemes:
 *   - none   — no auth. Anyone reaching the URL can fire. Local-only setups.
 *   - bearer — header `Authorization: Bearer <secret>`. Simplest shared-secret.
 *   - hmac   — HMAC(body, secret), compared against a signature header.
 *              `scheme:'stripe'` switches to HMAC(`<ts>.<body>`) and the
 *              header is `t=<ts>,v1=<sig>` (Stripe convention).
 *
 * Constant-time comparison everywhere. Always returns a structured
 * verdict — the caller decides whether to log the rejection reason
 * (useful) or hide it (preferable in production).
 */

export interface VerificationInput {
  readonly verification: WebhookVerification;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
  /** For Stripe scheme: epoch-ms used to verify timestamp tolerance. */
  readonly nowMs?: number;
}

export type VerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function lower(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function safeEqHex(aHex: string, bHex: string): boolean {
  // Strip a common 'sha256=' / 'sha1=' prefix off either side if the
  // caller forgot to. Lengths still need to match after stripping.
  const aTrim = aHex.replace(/^sha(?:256|1)=/, '').toLowerCase();
  const bTrim = bHex.replace(/^sha(?:256|1)=/, '').toLowerCase();
  if (aTrim.length !== bTrim.length) return false;
  try {
    return timingSafeEqual(Buffer.from(aTrim, 'hex'), Buffer.from(bTrim, 'hex'));
  } catch {
    return false;
  }
}

export function verifyDelivery(input: VerificationInput): VerificationResult {
  const v = input.verification;
  if (v.type === 'none') return { ok: true };

  if (v.type === 'bearer') {
    const auth = lower(input.headers, 'authorization');
    if (!auth) return { ok: false, reason: 'missing Authorization header' };
    // Compare the whole `Authorization` header against the expected
    // `Bearer <secret>` in constant time (length mismatch short-circuits
    // without leaking via timingSafeEqual's throw on unequal lengths).
    if (!bearerTokenMatches(auth, `Bearer ${v.secret}`)) {
      return { ok: false, reason: 'token mismatch' };
    }
    return { ok: true };
  }

  // HMAC.
  const header = lower(input.headers, v.signatureHeader);
  if (!header) {
    return { ok: false, reason: `missing signature header "${v.signatureHeader}"` };
  }

  if (v.scheme === 'stripe') {
    // Stripe-Signature: `t=1492774577,v1=5257a8...,v0=...`
    const parts: Record<string, string[]> = {};
    for (const piece of header.split(',')) {
      const eq = piece.indexOf('=');
      if (eq < 0) continue;
      const k = piece.slice(0, eq).trim();
      const val = piece.slice(eq + 1).trim();
      (parts[k] ??= []).push(val);
    }
    const ts = parts['t']?.[0];
    const sigs = parts['v1'] ?? [];
    if (!ts || sigs.length === 0) {
      return { ok: false, reason: 'malformed Stripe signature header' };
    }
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) {
      return { ok: false, reason: 'non-numeric timestamp in signature' };
    }
    const now = input.nowMs ?? Date.now();
    const driftSec = Math.abs(now / 1000 - tsNum);
    if (driftSec > v.timestampToleranceSec) {
      return { ok: false, reason: `timestamp drift ${Math.round(driftSec)}s exceeds tolerance` };
    }
    const payload = `${ts}.${input.body.toString('utf8')}`;
    const computed = createHmac(v.algorithm, v.secret).update(payload).digest('hex');
    for (const sig of sigs) {
      if (safeEqHex(computed, sig)) return { ok: true };
    }
    return { ok: false, reason: 'signature mismatch' };
  }

  // Plain HMAC over the raw body.
  const computed = createHmac(v.algorithm, v.secret).update(input.body).digest('hex');
  const expected = v.prefix ? `${v.prefix}${computed}` : computed;
  if (safeEqHex(header, expected)) return { ok: true };
  return { ok: false, reason: 'signature mismatch' };
}

/** Extract the idempotency key configured on the trigger, or null. */
export function idempotencyKey(
  trigger: WebhookTrigger,
  headers: Record<string, string | string[] | undefined>,
): string | null {
  if (!trigger.idempotencyHeader) return null;
  const v = headers[trigger.idempotencyHeader.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
