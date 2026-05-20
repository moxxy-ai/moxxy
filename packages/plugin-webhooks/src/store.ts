import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ulid } from 'ulid';
import { z } from 'zod';

/**
 * Persistent store for webhook triggers. Single JSON file at
 * `~/.moxxy/webhooks.json`. Mutations serialize through a promise-chain
 * mutex; writes land via tmp-file + rename so a crash mid-write leaves
 * the previous state intact (same pattern as the scheduler/vault).
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
export const filterRuleSchema = z
  .discriminatedUnion('source', [
    z.object({
      source: z.literal('header'),
      name: z.string().min(1),
      equals: z.array(z.string()).optional(),
      matches: z.string().optional(),
    }),
    z.object({
      source: z.literal('jsonPath'),
      /** Dot-separated path, e.g. "action" or "pull_request.user.login". */
      path: z.string().min(1),
      equals: z.array(z.string()).optional(),
      matches: z.string().optional(),
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
  enabled: z.boolean().default(true),
  createdAt: z.number().int(),
  lastFiredAt: z.number().int().optional(),
  fireCount: z.number().int().nonnegative().default(0),
  lastResult: z.enum(['ok', 'error']).optional(),
  lastError: z.string().optional(),
});

export type WebhookTrigger = z.infer<typeof webhookTriggerSchema>;

const fileSchema = z.object({
  version: z.literal(1),
  triggers: z.array(webhookTriggerSchema),
});

export interface WebhookStoreOptions {
  /** Override path — primarily for tests. Defaults to `~/.moxxy/webhooks.json`. */
  readonly file?: string;
}

export function defaultWebhooksFile(): string {
  return path.join(process.env.MOXXY_HOME ?? path.join(homedir(), '.moxxy'), 'webhooks.json');
}

export class WebhookStore {
  private readonly file: string;
  private cache: WebhookTrigger[] | null = null;
  private mutation: Promise<void> = Promise.resolve();

  constructor(opts: WebhookStoreOptions = {}) {
    this.file = opts.file ?? defaultWebhooksFile();
  }

  invalidate(): void {
    this.cache = null;
  }

  async list(): Promise<ReadonlyArray<WebhookTrigger>> {
    await this.ensureLoaded();
    return this.cache!.slice();
  }

  async get(id: string): Promise<WebhookTrigger | null> {
    await this.ensureLoaded();
    return this.cache!.find((t) => t.id === id) ?? null;
  }

  async getByName(name: string): Promise<WebhookTrigger | null> {
    await this.ensureLoaded();
    return this.cache!.find((t) => t.name === name) ?? null;
  }

  async create(
    input: Omit<WebhookTrigger, 'id' | 'createdAt' | 'enabled' | 'fireCount'> &
      Partial<Pick<WebhookTrigger, 'enabled'>>,
  ): Promise<WebhookTrigger> {
    const existing = await this.getByName(input.name);
    if (existing) throw new Error(`a webhook trigger named "${input.name}" already exists`);
    const entry = webhookTriggerSchema.parse({
      ...input,
      id: ulid(),
      createdAt: Date.now(),
      enabled: input.enabled ?? true,
      fireCount: 0,
    });
    await this.mutate((triggers) => {
      triggers.push(entry);
      return triggers;
    });
    return entry;
  }

  async update(id: string, patch: Partial<WebhookTrigger>): Promise<WebhookTrigger | null> {
    let updated: WebhookTrigger | null = null;
    await this.mutate((triggers) => {
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
    await this.mutate((triggers) => {
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
    await this.mutate((triggers) => {
      const idx = triggers.findIndex((t) => t.id === id);
      if (idx < 0) return triggers;
      const current = triggers[idx]!;
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

  private async ensureLoaded(): Promise<void> {
    if (this.cache) return;
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      this.cache = parsed.success ? [...parsed.data.triggers] : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
      } else {
        this.cache = [];
      }
    }
  }

  private async mutate(
    fn: (triggers: WebhookTrigger[]) => WebhookTrigger[],
  ): Promise<void> {
    const next = this.mutation.then(async () => {
      await this.ensureLoaded();
      const updated = fn(this.cache!.slice());
      this.cache = updated;
      await this.persist(updated);
    });
    this.mutation = next.catch(() => undefined);
    return next;
  }

  private async persist(triggers: WebhookTrigger[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ version: 1, triggers }, null, 2);
    await writeFile(tmp, payload, 'utf8');
    await rename(tmp, this.file);
  }
}
