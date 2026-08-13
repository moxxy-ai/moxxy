import { createHash } from 'node:crypto';
import {
  auditActionOf,
  redactSecrets,
  redactSecretText,
  type MoxxyEvent,
  type UnchainedAuditRecord,
} from '@moxxy/sdk';

/** How much redacted detail a record may carry. An audit trail is read by
 *  humans and shipped to a SIEM, so a single record must stay small even when
 *  the underlying tool input is a megabyte of file content. */
const MAX_DETAIL_CHARS = 512;

export interface AuditProjectionOptions {
  /**
   * Record prompt TEXT, not just its length and hash. Off by default: the
   * trail's job is to prove what was done, and prompts routinely contain
   * business content that has no business leaving the machine. The hash is
   * still recorded either way, so a specific prompt can be PROVEN to be the one
   * audited without the trail itself disclosing it.
   */
  readonly includePromptText?: boolean;
}

/**
 * Project an event onto an audit record, or null when the event is
 * conversation rather than something an auditor reviews.
 *
 * Everything that survives here is metadata or redacted, so the result is safe
 * to forward off the machine without a second sanitising pass at the sink.
 */
export function projectAuditRecord(
  event: MoxxyEvent,
  opts: AuditProjectionOptions = {},
): UnchainedAuditRecord | null {
  const action = auditActionOf(event);
  if (!action) return null;

  const base = {
    ts: event.ts,
    sessionId: event.sessionId,
    turnId: event.turnId,
    action,
    eventType: event.type,
    ...(event.actor ? { actor: event.actor } : {}),
  } as const;

  const detail = detailOf(event, opts);
  return detail ? { ...base, detail } : base;
}

function detailOf(
  event: MoxxyEvent,
  opts: AuditProjectionOptions,
): Readonly<Record<string, unknown>> | undefined {
  switch (event.type) {
    case 'user_prompt':
      return {
        chars: event.text.length,
        sha256: sha256(event.text),
        ...(event.attachments?.length ? { attachments: event.attachments.length } : {}),
        // An ambient trigger (webhook, schedule, workflow) means no human typed
        // this, which is exactly the kind of thing an auditor is looking for.
        ...(event.origin ? { origin: `${event.origin.kind}:${event.origin.name}` } : {}),
        ...(opts.includePromptText ? { text: cap(redactSecretText(event.text)) } : {}),
      };
    case 'tool_call_requested':
      return {
        callId: event.callId,
        tool: event.name,
        // Both: the preview is what a human reads, the hash is what proves the
        // input was not something else.
        inputSha256: sha256(stableStringify(event.input)),
        input: cap(stableStringify(redactSecrets(event.input))),
        ...(event.skillContext ? { skill: event.skillContext } : {}),
      };
    case 'tool_call_approved':
      return { callId: event.callId, decidedBy: event.decidedBy, mode: event.mode };
    case 'tool_call_denied':
      return { callId: event.callId, decidedBy: event.decidedBy, reason: cap(event.reason) };
    case 'tool_result':
      return {
        callId: event.callId,
        ok: event.ok,
        ...(event.error ? { errorKind: event.error.kind, error: cap(event.error.message) } : {}),
      };
    case 'skill_invoked':
      return { skill: event.name, reason: event.reason };
    case 'skill_created':
      // A skill the agent wrote for itself is durable new capability, so the
      // path and scope matter more than the prompt that produced it.
      return { skill: event.name, scope: event.scope, path: event.path };
    case 'plugin_registered':
    case 'plugin_unregistered':
      return { plugin: event.pluginId };
    case 'provider_response':
      // Counts only. The request and the reply are conversation and belong in
      // the event log; what an auditor needs here is what it cost and to whom.
      return {
        provider: event.provider,
        model: event.model,
        ...(event.inputTokens !== undefined ? { inputTokens: event.inputTokens } : {}),
        ...(event.outputTokens !== undefined ? { outputTokens: event.outputTokens } : {}),
        ...(event.cacheReadTokens !== undefined ? { cacheReadTokens: event.cacheReadTokens } : {}),
        ...(event.cacheCreationTokens !== undefined
          ? { cacheCreationTokens: event.cacheCreationTokens }
          : {}),
      };
    case 'error':
      return { message: cap(redactSecretText(event.message)) };
    default:
      return undefined;
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function cap(text: string): string {
  return text.length <= MAX_DETAIL_CHARS ? text : `${text.slice(0, MAX_DETAIL_CHARS)}…`;
}

/**
 * Deterministic JSON for hashing tool input: object keys are emitted sorted, so
 * two structurally identical inputs hash the same regardless of key order.
 * Falls back to a marker for values JSON cannot represent (cycles, BigInt)
 * rather than throwing inside the audit path.
 */
function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v: unknown) => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }) ?? 'undefined';
  } catch {
    return '[unserializable]';
  }
}
