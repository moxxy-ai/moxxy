import { readFile } from 'node:fs/promises';
import { createMutex, type Mutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
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
  publicUrlSource: z.enum(['manual', 'proxy', 'other']).optional(),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

/**
 * True when `host` only binds the local machine. Anything else (`0.0.0.0`,
 * `::`, a LAN/public IP, a hostname) exposes the unauthenticated POST surface
 * to other hosts — callers warn loudly on a non-loopback bind, especially when
 * a trigger uses verification:'none'.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]') return true;
  // The whole 127.0.0.0/8 block is loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

const fileSchema = z.object({
  version: z.literal(1),
  config: webhookConfigSchema,
});

export interface WebhookConfigStoreOptions {
  readonly file?: string;
}

export function defaultWebhookConfigFile(): string {
  return moxxyPath('webhooks-config.json');
}

export class WebhookConfigStore {
  private readonly file: string;
  private cache: WebhookConfig | null = null;
  private readonly mutex: Mutex = createMutex();

  constructor(opts: WebhookConfigStoreOptions = {}) {
    this.file = opts.file ?? defaultWebhookConfigFile();
  }

  async get(): Promise<WebhookConfig> {
    await this.ensureLoaded();
    return { ...this.cache! };
  }

  async set(patch: Partial<WebhookConfig>): Promise<WebhookConfig> {
    return this.mutex.run(async () => {
      await this.ensureLoaded();
      const merged = webhookConfigSchema.parse({ ...this.cache, ...patch });
      this.cache = merged;
      await this.persist(merged);
      return merged;
    });
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
    } catch {
      // No file yet (ENOENT) or an unreadable/corrupt file: fall back to defaults.
      this.cache = webhookConfigSchema.parse({});
    }
  }

  private async persist(config: WebhookConfig): Promise<void> {
    const payload = JSON.stringify({ version: 1, config }, null, 2);
    await writeFileAtomic(this.file, payload);
  }
}
