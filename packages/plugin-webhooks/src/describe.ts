import type { WebhookTrigger, WebhookVerification } from './store.js';

/**
 * Shaping helpers shared by the agent-facing tools. Kept separate so
 * `tools.ts` only worries about wiring + descriptions, and the redaction
 * rules for secrets live in one place.
 */

export function describeTrigger(
  trigger: WebhookTrigger,
  publicUrl: string | undefined,
): Record<string, unknown> {
  const url = publicUrl ? `${publicUrl.replace(/\/$/, '')}/webhook/${trigger.id}` : null;
  return {
    id: trigger.id,
    name: trigger.name,
    description: trigger.description ?? null,
    enabled: trigger.enabled,
    url,
    localPath: `/webhook/${trigger.id}`,
    promptPreview: trigger.prompt.slice(0, 240),
    allowedTools: trigger.allowedTools,
    model: trigger.model ?? null,
    verification: redactVerification(trigger.verification),
    filters: trigger.filters,
    idempotencyHeader: trigger.idempotencyHeader ?? null,
    // The session this webhook delivers to (where its runs fire + display).
    // null = owner-less (legacy single-process / fire in-process).
    targetSessionId: trigger.ownerSessionId ?? null,
    fireCount: trigger.fireCount,
    lastFiredAt: trigger.lastFiredAt ?? null,
    lastResult: trigger.lastResult ?? null,
    lastError: trigger.lastError ?? null,
    createdAt: trigger.createdAt,
  };
}

/** Strip the actual secret values, surfacing only the shape + which fields are set. */
export function redactVerification(v: WebhookVerification): Record<string, unknown> {
  if (v.type === 'none') return { type: 'none' };
  if (v.type === 'bearer') return { type: 'bearer', secretSet: true };
  const base: Record<string, unknown> = {
    type: 'hmac',
    secretSet: true,
    signatureHeader: v.signatureHeader,
    algorithm: v.algorithm,
    scheme: v.scheme,
  };
  if (v.prefix) base.prefix = v.prefix;
  if (v.scheme === 'stripe') base.timestampToleranceSec = v.timestampToleranceSec;
  return base;
}
