import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

/**
 * Per-host webhook config: where the listener binds and what public URL
 * external providers should hit. Lives at `~/.moxxy/webhooks-config.json`.
 * The agent's `webhook_set_public_url` / `webhook_tunnel_start` tools
 * write here so the URL survives restarts.
 */

export const webhookConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(3738),
  /**
   * Public URL the external provider will POST to (e.g.
   * "https://abc-123.trycloudflare.com"). Without it, the agent can
   * still create triggers — but it must walk the user through tunneling
   * or accept that the webhook is local-network only.
   */
  publicUrl: z.string().url().optional(),
  /** Provenance — set by webhook_tunnel_start so the agent knows whether
   *  to stop a tunnel on cleanup. */
  publicUrlSource: z.enum(['manual', 'cloudflared', 'ngrok', 'other']).optional(),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

const fileSchema = z.object({
  version: z.literal(1),
  config: webhookConfigSchema,
});

export interface WebhookConfigStoreOptions {
  readonly file?: string;
}

export function defaultWebhookConfigFile(): string {
  return path.join(
    process.env.MOXXY_HOME ?? path.join(homedir(), '.moxxy'),
    'webhooks-config.json',
  );
}

export class WebhookConfigStore {
  private readonly file: string;
  private cache: WebhookConfig | null = null;
  private mutation: Promise<void> = Promise.resolve();

  constructor(opts: WebhookConfigStoreOptions = {}) {
    this.file = opts.file ?? defaultWebhookConfigFile();
  }

  async get(): Promise<WebhookConfig> {
    await this.ensureLoaded();
    return { ...this.cache! };
  }

  async set(patch: Partial<WebhookConfig>): Promise<WebhookConfig> {
    let result: WebhookConfig | null = null;
    const next = this.mutation.then(async () => {
      await this.ensureLoaded();
      const merged = webhookConfigSchema.parse({ ...this.cache, ...patch });
      this.cache = merged;
      result = merged;
      await this.persist(merged);
    });
    this.mutation = next.catch(() => undefined);
    await next;
    return result!;
  }

  async clearPublicUrl(): Promise<WebhookConfig> {
    return this.set({ publicUrl: undefined, publicUrlSource: undefined });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache) return;
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      this.cache = parsed.success ? parsed.data.config : webhookConfigSchema.parse({});
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = webhookConfigSchema.parse({});
      } else {
        this.cache = webhookConfigSchema.parse({});
      }
    }
  }

  private async persist(config: WebhookConfig): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ version: 1, config }, null, 2);
    await writeFile(tmp, payload, 'utf8');
    await rename(tmp, this.file);
  }
}
