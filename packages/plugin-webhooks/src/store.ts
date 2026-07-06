import { rename } from 'node:fs/promises';
import { assertDefined, createJsonFileStore, type JsonFileStore } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { ulid } from 'ulid';
import { z } from 'zod';

/**
 * Persistent store for webhook triggers. Single JSON file at
 * `~/.moxxy/webhooks.json`. Mutations serialize through a write mutex;
 * writes land via an atomic whole-file write so a crash mid-write leaves
 * the previous state intact (same pattern as the scheduler/vault).
 *
 * Corruption is never silently swallowed: a file that exists but cannot
 * be parsed (or doesn't match the file schema) is renamed aside to
 * `webhooks.json.corrupt-<timestamp>` BEFORE the store starts empty, so a
 * subsequent write can never clobber the only copy of the triggers (and
 * their secrets). Individually invalid entries inside an otherwise valid
 * file are quarantined to `webhooks.json.quarantine-<timestamp>` and the
 * valid ones kept. Either way the condition is logged and surfaced to the
 * tools via {@link WebhookStore.loadWarning}.
 *
 * The store knows nothing about HTTP or verification — it just owns
 * the entry records. The server and verifier read from it.
 */

export const verificationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('bearer'),
    /** Plain token compared against `Authorization: Bearer <token>`. */
    secret: z.string().min(8),
  }),
  z.object({
    type: z.literal('hmac'),
    /** Shared secret used for HMAC. */
    secret: z.string().min(8),
    /** Header carrying the signature. Lower-cased on read. */
    signatureHeader: z.string().min(1),
    /** Digest algorithm. */
    algorithm: z.enum(['sha256', 'sha1']).default('sha256'),
    /** Optional prefix the provider prepends to the digest (e.g. "sha256="). */
    prefix: z.string().optional(),
    /** "stripe" → header is `t=<ts>,v1=<sig>` and HMAC input is `<ts>.<body>`. */
    scheme: z.enum(['plain', 'stripe']).default('plain'),
    /** Reject deliveries whose timestamp drifts beyond this many seconds (stripe scheme only). */
    timestampToleranceSec: z.number().int().positive().default(300),
  }),
]);

export type WebhookVerification = z.infer<typeof verificationSchema>;

/**
 * Filter rule. A trigger may declare `include` / `exclude` lists; the
 * server evaluates them after verification:
 *   - include is empty OR any rule matches  →  pass
 *   - any exclude rule matches              →  drop
 *
 * Each rule reads ONE field (header or json-body-path), compares it
 * against either `equals` (any-of, string-coerced) or `matches` (regex).
 * Both is OR. No regex flags syntax — keep it predictable.
 */
/**
 * The `matches` regex runs against fully untrusted request data on the pre-ACK
 * hot path. Cap its source length AND reject patterns that don't compile at
 * trigger-create/load time, so an over-long / malformed regex can never reach
 * the dispatcher (compileMatcher in filter.ts bounds the rest of the worst
 * case: cached compilation + a length-bounded value slice).
 */
const MAX_MATCH_SOURCE_LEN = 512;
const matchesSchema = z
  .string()
  .max(MAX_MATCH_SOURCE_LEN, `regex must be at most ${MAX_MATCH_SOURCE_LEN} characters`)
  .refine(
    (src) => {
      try {
        new RegExp(src);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'invalid regex in `matches`' },
  )
  .optional();

export const filterRuleSchema = z
  .discriminatedUnion('source', [
    z.object({
      source: z.literal('header'),
      name: z.string().min(1),
      equals: z.array(z.string()).optional(),
      matches: matchesSchema,
    }),
    z.object({
      source: z.literal('jsonPath'),
      /** Dot-separated path, e.g. "action" or "pull_request.user.login". */
      path: z.string().min(1),
      equals: z.array(z.string()).optional(),
      matches: matchesSchema,
    }),
  ])
  .refine((r) => !!r.equals || !!r.matches, {
    message: 'filter rule must declare `equals` or `matches`',
  });

export type FilterRule = z.infer<typeof filterRuleSchema>;

export const filterSchema = z
  .object({
    include: z.array(filterRuleSchema).default([]),
    exclude: z.array(filterRuleSchema).default([]),
  })
  .default({ include: [], exclude: [] });

export type WebhookFilter = z.infer<typeof filterSchema>;

export const webhookTriggerSchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, 'name must be slug-like'),
  /**
   * Prompt template used when the trigger fires. Supports
   * `{body}`, `{body_json}`, `{header.<name>}`, `{method}`, `{path}`,
   * `{trigger_name}`, `{fired_at}`. Unknown placeholders are left intact.
   */
  prompt: z.string().min(1),
  /** Tools the triggered session is allowed to call. Defaults to []. */
  allowedTools: z.array(z.string()).default([]),
  /** Optional model override for the triggered session. */
  model: z.string().optional(),
  verification: verificationSchema,
  /** Filters decide whether a verified delivery actually fires the prompt. */
  filters: filterSchema,
  /** Header whose value identifies a delivery for dedupe. */
  idempotencyHeader: z.string().optional(),
  /** Free-form note shown in `webhook_list`. */
  description: z.string().optional(),
  /**
   * The session that created this trigger (the creating runner's
   * `MOXXY_SESSION_ID`). The webhook listener binds a single shared port, so
   * one runner process receives EVERY delivery — but the prompt must fire on the
   * runner whose chat asked for the webhook. This is the routing key: a delivery
   * for a trigger owned by another runner is handed off to that runner (via the
   * shared delivery queue) instead of firing on whoever received the HTTP
   * request. Unset for a single-process CLI (no `MOXXY_SESSION_ID`) — those fire
   * in-process as before.
   */
  ownerSessionId: z.string().optional(),
  enabled: z.boolean().default(true),
  createdAt: z.number().int(),
  lastFiredAt: z.number().int().optional(),
  fireCount: z.number().int().nonnegative().default(0),
  lastResult: z.enum(['ok', 'error']).optional(),
  lastError: z.string().optional(),
});

export type WebhookTrigger = z.infer<typeof webhookTriggerSchema>;

/**
 * Top-level file shape, validated loosely first so a single bad entry
 * doesn't condemn the whole file: entries are re-validated one by one
 * against {@link webhookTriggerSchema} and bad ones quarantined.
 */
const looseFileSchema = z.object({
  version: z.literal(1),
  triggers: z.array(z.unknown()),
});

export interface WebhookStoreLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

export interface WebhookStoreOptions {
  /** Override path — primarily for tests. Defaults to `~/.moxxy/webhooks.json`. */
  readonly file?: string;
  /** Where corruption/quarantine events are reported. */
  readonly logger?: WebhookStoreLogger;
}

export function defaultWebhooksFile(): string {
  return moxxyPath('webhooks.json');
}

export class WebhookStore {
  private readonly file: string;
  private readonly logger: WebhookStoreLogger | undefined;
  private loadWarningMsg: string | null = null;
  // Generic id-collection store owns the cache, write mutex, RMW `.slice()`
  // copy, and crash-atomic `{ version: 1, triggers: [...] }` write. Corruption
  // policy (preserve aside / quarantine / refuse-on-unreadable) stays here in
  // the `load`/`onReadError` hooks, byte-for-byte as before.
  private readonly store: JsonFileStore<WebhookTrigger>;

  constructor(opts: WebhookStoreOptions = {}) {
    this.file = opts.file ?? defaultWebhooksFile();
    this.logger = opts.logger;
    this.store = createJsonFileStore<WebhookTrigger>({
      file: this.file,
      itemsKey: 'triggers',
      load: (raw) => this.parseFile(raw),
      onReadError: (err) => {
        // Present but unreadable (permissions, I/O, ...): refuse to operate.
        // Treating this as empty would let the next persist() overwrite the
        // only copy of every trigger and its secrets.
        throw new Error(
          `webhooks store: cannot read ${this.file}: ` +
            `${err instanceof Error ? err.message : String(err)} — ` +
            'refusing to load (and write) until the file is readable again',
        );
      },
    });
  }

  invalidate(): void {
    this.store.invalidate();
    this.loadWarningMsg = null;
  }

  /**
   * Human-readable description of any corruption encountered while loading
   * the store file (corrupt file preserved aside, or invalid entries
   * quarantined), or `null` when the load was clean. Tools surface this so
   * the user learns about it instead of silently losing triggers.
   */
  async loadWarning(): Promise<string | null> {
    await this.store.read();
    return this.loadWarningMsg;
  }

  async list(): Promise<ReadonlyArray<WebhookTrigger>> {
    return this.store.read();
  }

  async get(id: string): Promise<WebhookTrigger | null> {
    return this.store.get(id);
  }

  async getByName(name: string): Promise<WebhookTrigger | null> {
    const all = await this.store.read();
    return all.find((t) => t.name === name) ?? null;
  }

  async create(
    input: Omit<WebhookTrigger, 'id' | 'createdAt' | 'enabled' | 'fireCount'> &
      Partial<Pick<WebhookTrigger, 'enabled'>>,
  ): Promise<WebhookTrigger> {
    const entry = webhookTriggerSchema.parse({
      ...input,
      id: ulid(),
      createdAt: Date.now(),
      enabled: input.enabled ?? true,
      fireCount: 0,
    });
    // The name-uniqueness check must live INSIDE the mutate critical section:
    // checking against a snapshot read outside the mutex could let two
    // concurrent creates of the same name both pass the check and both commit.
    // mutate() hands us a fresh copy of the current state under the mutex.
    await this.store.mutate((triggers) => {
      if (triggers.some((t) => t.name === entry.name)) {
        throw new Error(`a webhook trigger named "${entry.name}" already exists`);
      }
      triggers.push(entry);
      return triggers;
    });
    return entry;
  }

  async update(id: string, patch: Partial<WebhookTrigger>): Promise<WebhookTrigger | null> {
    let updated: WebhookTrigger | null = null;
    await this.store.mutate((triggers) => {
      const idx = triggers.findIndex((t) => t.id === id);
      if (idx < 0) return triggers;
      const next = webhookTriggerSchema.parse({ ...triggers[idx], ...patch });
      triggers[idx] = next;
      updated = next;
      return triggers;
    });
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    let removed = false;
    await this.store.mutate((triggers) => {
      const before = triggers.length;
      const after = triggers.filter((t) => t.id !== id);
      removed = after.length < before;
      return after;
    });
    return removed;
  }

  /** Atomic increment + outcome write, used by the dispatcher on every fire. */
  async recordFire(
    id: string,
    outcome: { ok: boolean; error?: string },
  ): Promise<WebhookTrigger | null> {
    let updated: WebhookTrigger | null = null;
    await this.store.mutate((triggers) => {
      const idx = triggers.findIndex((t) => t.id === id);
      if (idx < 0) return triggers;
      const current = triggers[idx];
      // idx >= 0 here (the < 0 case returned above), so the element exists.
      assertDefined(current, 'trigger at findIndex result');
      const next = webhookTriggerSchema.parse({
        ...current,
        lastFiredAt: Date.now(),
        fireCount: current.fireCount + 1,
        lastResult: outcome.ok ? 'ok' : 'error',
        ...(outcome.ok
          ? { lastError: undefined }
          : { lastError: (outcome.error ?? 'unknown error').slice(0, 500) }),
      });
      triggers[idx] = next;
      updated = next;
      return triggers;
    });
    return updated;
  }

  /**
   * Parse + validate the file contents into the trigger array, owning all
   * corruption policy. Called by the generic store on load with the raw
   * UTF-8 string, or `null` when the file is absent (a legitimate fresh
   * start). A present-but-unreadable file is handled upstream by the
   * generic's `onReadError` hook (which throws to refuse operation).
   */
  private async parseFile(raw: string | null): Promise<WebhookTrigger[]> {
    this.loadWarningMsg = null;
    if (raw === null) return [];

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.preserveCorruptFile('is not valid JSON');
    }

    const file = looseFileSchema.safeParse(json);
    if (!file.success) {
      return this.preserveCorruptFile(
        'does not match the expected { version: 1, triggers: [...] } shape',
      );
    }

    const valid: WebhookTrigger[] = [];
    const invalid: Array<{ index: number; entry: unknown; issues: string }> = [];
    file.data.triggers.forEach((entry, index) => {
      const parsed = webhookTriggerSchema.safeParse(entry);
      if (parsed.success) {
        valid.push(parsed.data);
      } else {
        invalid.push({
          index,
          entry,
          issues: parsed.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; '),
        });
      }
    });
    if (invalid.length > 0) await this.quarantineEntries(invalid);
    return valid;
  }

  /**
   * The file exists but is unparseable/mis-shaped. Rename it aside (rename,
   * not copy — nothing may remain at the live path that a later persist()
   * could clobber while it is the only copy), then start empty. If the
   * rename itself fails the error propagates and the store refuses to
   * operate, which is the safe direction.
   */
  private async preserveCorruptFile(reason: string): Promise<WebhookTrigger[]> {
    const preserved = `${this.file}.corrupt-${timestampSlug()}`;
    await rename(this.file, preserved);
    this.loadWarningMsg =
      `the webhook trigger store (${this.file}) ${reason}; the original file was preserved ` +
      `at ${preserved} and the store restarted empty. Previously configured triggers (and ` +
      'their secrets) are recoverable from that file — repair it by hand or recreate the triggers.';
    const logger = this.logger;
    if (logger?.error) {
      logger.error('webhooks: store file corrupt — preserved aside, starting empty', {
        file: this.file,
        preserved,
        reason,
      });
    }
    return [];
  }

  /**
   * The file parses but some entries fail validation. Keep the valid ones,
   * write the rest (verbatim, with their zod issues) to a 0600 sidecar so
   * they stay recoverable after the next persist() drops them.
   */
  private async quarantineEntries(
    invalid: ReadonlyArray<{ index: number; entry: unknown; issues: string }>,
  ): Promise<void> {
    const quarantine = `${this.file}.quarantine-${timestampSlug()}`;
    const payload = JSON.stringify(
      {
        quarantinedAt: new Date().toISOString(),
        source: this.file,
        entries: invalid,
      },
      null,
      2,
    );
    // 0600 — quarantined entries may carry verification secrets.
    await writeFileAtomic(quarantine, payload, { mode: 0o600 });
    this.loadWarningMsg =
      `${invalid.length} trigger entr${invalid.length === 1 ? 'y' : 'ies'} in ${this.file} ` +
      `failed schema validation and ${invalid.length === 1 ? 'was' : 'were'} quarantined to ` +
      `${quarantine} (valid triggers were kept). Inspect that file to repair or recreate them.`;
    const logger = this.logger;
    if (logger?.error) {
      logger.error('webhooks: invalid trigger entries quarantined', {
        file: this.file,
        quarantine,
        count: invalid.length,
        issues: invalid.map((i) => ({ index: i.index, issues: i.issues })),
      });
    }
  }

}

/** Filesystem-safe timestamp for `.corrupt-*` / `.quarantine-*` sidecars. */
function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
