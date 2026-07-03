import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import type { WebhookConfigStore } from '../config.js';
import type { WebhookDispatcher } from '../runner.js';
import { filterRuleSchema, type WebhookStore, type WebhookVerification } from '../store.js';
import type { RunningTunnel } from '../tunnel.js';

/**
 * Shared dependencies + helpers for the per-tool webhook factories.
 *
 * Agent-facing tools. Tool descriptions are the contract with the
 * model — they have to read like a runbook for a non-technical user.
 *
 * Provider-agnostic by design: this plugin doesn't know GitHub from
 * Stripe from a private internal service. The setup guide walks the
 * agent through *asking* the user for the provider-specific bits
 * (header name, prefix, secret, events to include/exclude) rather than
 * baking any names in.
 */

export interface WebhooksToolDeps {
  readonly store: WebhookStore;
  readonly config: WebhookConfigStore;
  readonly dispatcher: WebhookDispatcher;
  readonly tunnelHandle: { current: RunningTunnel | null };
  /**
   * Where generated secrets are written for out-of-band pickup by the
   * user. Override — primarily for tests. Default: `~/.moxxy/webhooks-secrets/`.
   */
  readonly secretsDir?: string;
  /**
   * This runner's session identity (`MOXXY_SESSION_ID`). Stamped onto triggers
   * created via `webhook_create` so their deliveries fire on the runner whose
   * chat asked for the webhook, even though a different runner may own the shared
   * listener port. Undefined for a single-process CLI.
   */
  readonly ownerSessionId?: string;
}

/** Per-tool factories receive the resolved deps (secretsDir defaulted). */
export interface ResolvedToolDeps {
  readonly store: WebhookStore;
  readonly config: WebhookConfigStore;
  readonly dispatcher: WebhookDispatcher;
  readonly tunnelHandle: { current: RunningTunnel | null };
  readonly secretsDir: string;
  /** See {@link WebhooksToolDeps.ownerSessionId}. */
  readonly ownerSessionId?: string;
}

/** Owner-only directory where generated webhook secrets are written for the user. */
export function defaultWebhookSecretsDir(): string {
  return moxxyPath('webhooks-secrets');
}

/**
 * Capability globs the webhook tools declare (`isolation.capabilities.fs`).
 *
 * The trigger-store glob ends in `*` because the store quarantine-renames a
 * corrupt file to `webhooks.json.corrupt-<ts>` / `.quarantine-<ts>` on ANY
 * access — so even a read-only tool may legitimately write next to the file.
 */
export const WEBHOOKS_STORE_GLOB = '~/.moxxy/webhooks.json*';
export const WEBHOOKS_CONFIG_GLOB = '~/.moxxy/webhooks-config.json';
export const WEBHOOKS_SECRETS_GLOB = '~/.moxxy/webhooks-secrets/**';

export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Secrets never travel through the model's context (tool results land in
 * the session log and persist). The tool result carries only this masked
 * preview; the full value goes to an owner-only (0600) file the USER reads
 * directly.
 */
export function maskSecret(secret: string): string {
  return `${secret.slice(0, 4)}…`;
}

/** Where a given trigger's generated secret is parked for user pickup. */
export function secretFilePath(dir: string, triggerName: string): string {
  return path.join(dir, `${triggerName}.secret`);
}

export async function writeSecretFile(
  dir: string,
  triggerName: string,
  secret: string,
): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = secretFilePath(dir, triggerName);
  await writeFileAtomic(file, `${secret}\n`, { mode: 0o600 });
  return file;
}

/** Input shape mirrors the store schema but lets the agent omit `secret`
 *  so the tool can mint a strong one. The handler normalizes to the
 *  store's stricter shape before persisting. */
export const verificationInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('bearer'),
    secret: z.string().min(8).optional(),
  }),
  z.object({
    type: z.literal('hmac'),
    secret: z.string().min(8).optional(),
    signatureHeader: z.string().min(1),
    algorithm: z.enum(['sha256', 'sha1']).default('sha256'),
    prefix: z.string().optional(),
    scheme: z.enum(['plain', 'stripe']).default('plain'),
    timestampToleranceSec: z.number().int().positive().default(300),
  }),
]);

export type VerificationInput = z.infer<typeof verificationInputSchema>;

export const filterInputSchema = z.object({
  include: z.array(filterRuleSchema).default([]),
  exclude: z.array(filterRuleSchema).default([]),
});

interface NormalizedVerification {
  readonly verification: WebhookVerification;
  readonly secretIssued: string | null;
}

export function normalizeVerification(input: VerificationInput): NormalizedVerification {
  if (input.type === 'none') {
    return { verification: { type: 'none' }, secretIssued: null };
  }
  if (input.type === 'bearer') {
    if (input.secret) return { verification: { type: 'bearer', secret: input.secret }, secretIssued: null };
    const secret = generateSecret();
    return { verification: { type: 'bearer', secret }, secretIssued: secret };
  }
  const provided = input.secret;
  const secret = provided ?? generateSecret();
  return {
    verification: {
      type: 'hmac',
      secret,
      signatureHeader: input.signatureHeader,
      algorithm: input.algorithm,
      scheme: input.scheme,
      timestampToleranceSec: input.timestampToleranceSec,
      ...(input.prefix ? { prefix: input.prefix } : {}),
    },
    secretIssued: provided ? null : secret,
  };
}

export function fullUrl(publicUrl: string | undefined, triggerId: string): string | null {
  if (!publicUrl) return null;
  return `${publicUrl.replace(/\/$/, '')}/webhook/${triggerId}`;
}
