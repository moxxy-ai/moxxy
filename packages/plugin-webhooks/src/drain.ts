import type { WebhookDeliveryQueue } from './queue.js';
import type { WebhookDispatcher } from './runner.js';
import type { WebhookStore } from './store.js';

/**
 * Drains this runner's queued webhook deliveries.
 *
 * The listener runs in only ONE runner (whoever bound the shared port); when a
 * delivery's trigger is owned by a DIFFERENT runner, that listener enqueues it.
 * Every runner runs one of these pollers, draining only the records addressed to
 * its own `ownerSessionId` and firing them in-process — so the prompt lands in
 * the workspace that created the webhook. Ticks are serialized (a long fire
 * never overlaps the next tick), and a fired record is removed AFTER the attempt
 * (a duplicate on a mid-fire crash beats a lost delivery; removing post-attempt
 * stops a hard failure from looping).
 */
export interface WebhookDrainPollerOptions {
  readonly queue: WebhookDeliveryQueue;
  readonly store: WebhookStore;
  readonly dispatcher: WebhookDispatcher;
  /** This runner's identity; only records addressed to it are drained. */
  readonly ownerSessionId: string;
  /** Poll cadence in ms. Default 1500ms. Minimum 250ms. */
  readonly intervalMs?: number;
  /** Records older than this are swept regardless of owner. Default 7 days. */
  readonly staleMs?: number;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export class WebhookDrainPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private chain: Promise<void> = Promise.resolve();
  private readonly intervalMs: number;
  private readonly staleMs: number;

  constructor(private readonly opts: WebhookDrainPollerOptions) {
    this.intervalMs = Math.max(250, opts.intervalMs ?? 1_500);
    this.staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  }

  start(): void {
    if (this.timer) return;
    this.running = true;
    // Drain immediately on start so deliveries that queued while this runner was
    // down fire as soon as it's back.
    this.chain = this.drain().then(
      () => undefined,
      () => undefined,
    );
    this.timer = setInterval(() => {
      this.chain = this.chain.then(() => this.tick()).catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.chain.catch(() => undefined);
  }

  /** Drain now, ignoring the cadence; returns how many deliveries were fired. */
  async tickOnce(): Promise<number> {
    let fired = 0;
    this.chain = this.chain.then(async () => {
      fired = await this.drain();
    });
    await this.chain.catch(() => undefined);
    return fired;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    await this.drain();
  }

  private async drain(): Promise<number> {
    let records;
    try {
      records = await this.opts.queue.listOwned(this.opts.ownerSessionId);
    } catch (err) {
      const logger = this.opts.logger;
      if (logger?.warn) {
        logger.warn('webhooks: queue read failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
      return 0;
    }
    let fired = 0;
    for (const rec of records) {
      const trigger = await this.opts.store.get(rec.triggerId);
      if (!trigger) {
        // The trigger was deleted after the delivery queued — drop it.
        await this.opts.queue.remove(rec.id);
        continue;
      }
      try {
        await this.opts.dispatcher.fire(trigger, rec.prompt, rec.deliveryId);
        fired += 1;
      } catch (err) {
        const logger = this.opts.logger;
        if (logger?.warn) {
          logger.warn('webhooks: drained delivery failed', {
            trigger: trigger.name,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        await this.opts.queue.remove(rec.id);
      }
    }
    await this.opts.queue.sweepStale(this.staleMs).catch(() => undefined);
    return fired;
  }
}
