import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { ulid } from 'ulid';

/**
 * Shared on-disk hand-off queue for webhook deliveries.
 *
 * The listener binds a single port, so ONE runner process receives every
 * delivery — but a trigger created in another workspace must fire on THAT
 * workspace's runner (its chat). When the receiving runner isn't the trigger's
 * owner, it drops a delivery record here; the owning runner's drain poller picks
 * up its own records and fires them. The queue is a plain directory of atomic
 * JSON files under `~/.moxxy/webhooks/queue/`, one per delivery — same
 * file-store discipline as the rest of the framework, and durable so a delivery
 * for a currently-offline workspace waits until that runner comes back.
 */

export interface QueuedDelivery {
  /** Queue record id (the filename stem). */
  readonly id: string;
  readonly triggerId: string;
  readonly triggerName: string;
  /** The runner this delivery must fire on (the trigger's `ownerSessionId`). */
  readonly ownerSessionId: string;
  /** The fully-rendered prompt — it embeds the request body/headers, which are
   *  NOT re-derivable from the trigger alone, so it must travel with the record. */
  readonly prompt: string;
  /** Idempotency key from the delivery headers, if any (for the fire's dedupe). */
  readonly deliveryId: string | null;
  readonly enqueuedAt: number;
}

export function defaultWebhookQueueDir(): string {
  return moxxyPath('webhooks', 'queue');
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

export class WebhookDeliveryQueue {
  constructor(private readonly dir: string = defaultWebhookQueueDir()) {}

  /** Persist a delivery for its owner to drain. Returns the record id. */
  async enqueue(
    rec: Omit<QueuedDelivery, 'id' | 'enqueuedAt'> & { readonly enqueuedAt?: number },
  ): Promise<string> {
    // Prefer the delivery id (unique per delivery) so a provider's retry of the
    // SAME delivery overwrites rather than enqueuing a duplicate; fall back to a
    // ulid when there's no idempotency header.
    const id = rec.deliveryId ? safeId(rec.deliveryId) : ulid();
    const record: QueuedDelivery = {
      id,
      triggerId: rec.triggerId,
      triggerName: rec.triggerName,
      ownerSessionId: rec.ownerSessionId,
      prompt: rec.prompt,
      deliveryId: rec.deliveryId,
      enqueuedAt: rec.enqueuedAt ?? Date.now(),
    };
    await writeFileAtomic(path.join(this.dir, `${id}.json`), JSON.stringify(record));
    return id;
  }

  /** Every queued delivery for `ownerSessionId`, oldest first. Corrupt records
   *  are skipped (not thrown), so one bad file never stalls the drain. */
  async listOwned(ownerSessionId: string): Promise<QueuedDelivery[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: QueuedDelivery[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(path.join(this.dir, name), 'utf8');
        const rec = JSON.parse(raw) as QueuedDelivery;
        if (rec && typeof rec === 'object' && rec.ownerSessionId === ownerSessionId) out.push(rec);
      } catch {
        // corrupt/partial/racing-unlink — skip.
      }
    }
    out.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    return out;
  }

  /** Remove one drained record. Best-effort. */
  async remove(id: string): Promise<void> {
    try {
      await unlink(path.join(this.dir, `${safeId(id)}.json`));
    } catch {
      // already gone — fine.
    }
  }

  /**
   * Drop records older than `maxAgeMs` regardless of owner — covers deliveries
   * addressed to a runner that never came back (a deleted workspace). Returns
   * the count removed; best-effort.
   */
  async sweepStale(maxAgeMs: number, now: number = Date.now()): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(this.dir, name);
      try {
        const st = await stat(file);
        if (now - st.mtimeMs > maxAgeMs) {
          await unlink(file);
          removed += 1;
        }
      } catch {
        // racing unlink / unreadable — skip.
      }
    }
    return removed;
  }
}
