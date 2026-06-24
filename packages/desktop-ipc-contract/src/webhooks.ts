// ---------- Webhooks -------------------------------------------------------

/** Outcome of a trigger's most recent delivery. */
export type WebhookLastResult = 'ok' | 'error';

/**
 * A redacted view of a persisted webhook trigger — the fields the desktop
 * Webhooks panel renders. Mirrors the scheduler summary: the host reads the
 * shared webhooks store directly (so it sees triggers the agent's
 * `webhook_*` tools created), and `describeTrigger` strips the verification
 * secrets before this crosses the IPC boundary.
 */
export interface WebhookSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  /** Public delivery URL when a tunnel is up, else null. */
  readonly url: string | null;
  /** Always-present local path (`/webhook/<id>`). */
  readonly localPath: string;
  readonly promptPreview: string;
  readonly model: string | null;
  readonly fireCount: number;
  readonly lastFiredAt: number | null;
  readonly lastResult: WebhookLastResult | null;
  readonly lastError: string | null;
  readonly createdAt: number;
}

export interface WebhookDeleteResult {
  readonly deleted: boolean;
}
