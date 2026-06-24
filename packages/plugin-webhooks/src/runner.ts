import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import type { WebhookDeliveryQueue } from './queue.js';
import type { WebhookStore, WebhookTrigger } from './store.js';

/**
 * The plugin defers actual prompt execution to a bootstrap-supplied
 * runner. This keeps the plugin agnostic about Session lifetime,
 * isolated-vs-shared sessions, and provider selection — those concerns
 * live in the CLI / SDK consumer that wires the plugin together.
 *
 * For tests, supply a fake runner; for production, the CLI provides
 * one that calls `runTurn` against the active Session. Runners MUST
 * enforce the trigger's `allowedTools`: when non-empty, the fire may
 * only execute the listed tools (anything else gets a denial, not a
 * crash); when empty, the fire uses the session's full tool set under
 * its normal permission rules. The CLI runner implements this with a
 * per-fire scoped session view (filtered tool registry + wrapping
 * permission resolver) — fires run on the active session, not an
 * isolated one.
 */

export interface WebhookPromptRunner {
  runPrompt(input: {
    readonly prompt: string;
    readonly allowedTools: ReadonlyArray<string>;
    readonly model?: string;
    readonly triggerName: string;
  }): Promise<WebhookPromptResult>;
}

export interface WebhookPromptResult {
  readonly text: string;
  readonly error?: string;
}

export interface InboxOptions {
  readonly dir?: string;
}

export function defaultWebhookInboxDir(): string {
  return moxxyPath('inbox', 'webhooks');
}

async function writeInbox(
  trigger: WebhookTrigger,
  result: WebhookPromptResult,
  deliveryId: string | null,
  opts: InboxOptions = {},
): Promise<string> {
  const dir = opts.dir ?? defaultWebhookInboxDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // The timestamp is only ms-resolution: two deliveries of the same trigger in
  // the same millisecond (a retry/batch burst) would collide and the atomic
  // tmp+rename would silently overwrite one fire's output. Suffix with the
  // deliveryId (naturally unique per delivery) or a random fallback.
  const suffix = deliveryId ? deliveryId.replace(/[^A-Za-z0-9._-]/g, '_') : randomUUID().slice(0, 8);
  const file = path.join(dir, `${stamp}-${trigger.name}-${suffix}.md`);
  const header = [
    '---',
    `webhook: ${trigger.name}`,
    `firedAt: ${new Date().toISOString()}`,
    deliveryId ? `deliveryId: ${deliveryId}` : null,
    `outcome: ${result.error ? 'error' : 'ok'}`,
    '---',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
  const body = result.error ? `**error:** ${result.error}\n\n${result.text}` : result.text;
  await writeFileAtomic(file, header + body + '\n');
  return file;
}

export interface WebhookFireOutcome {
  readonly ok: boolean;
  readonly text: string;
  readonly error?: string;
  readonly inboxPath?: string;
}

export interface WebhookDispatcherOptions {
  readonly store: WebhookStore;
  readonly runner: WebhookPromptRunner;
  readonly inbox?: InboxOptions;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Optional hook fired after each delivery — channels use this to
   *  push a "your webhook fired" notification to the user. */
  readonly onFired?: (trigger: WebhookTrigger, outcome: WebhookFireOutcome) => void;
  /**
   * This runner's session identity (`MOXXY_SESSION_ID`), or undefined for a
   * single-process CLI. {@link route} uses it to decide whether a delivery
   * belongs to THIS runner (fire in-process) or another (hand off via the
   * queue).
   */
  readonly ownerSessionId?: string;
  /**
   * Shared hand-off queue. Required for cross-runner routing in {@link route};
   * without it, every delivery fires in-process (the single-process behavior).
   */
  readonly queue?: WebhookDeliveryQueue;
}

/** Outcome of {@link WebhookDispatcher.route}: either fired here, or handed off. */
export type WebhookRouteOutcome =
  | { readonly handled: 'fired'; readonly outcome: WebhookFireOutcome }
  | { readonly handled: 'enqueued'; readonly ownerSessionId: string };

/**
 * Runs prompts in response to verified webhook deliveries. Decoupled
 * from HTTP so it's testable in isolation and reusable from the
 * `webhook_test` tool that simulates a fire without going over the
 * network.
 */
export class WebhookDispatcher {
  constructor(private readonly opts: WebhookDispatcherOptions) {}

  /**
   * Decide where a verified, filtered delivery runs, then act:
   *  - owned by ANOTHER runner (and a queue is wired) → enqueue it for that
   *    runner's drain to fire, so the prompt lands in the chat that created the
   *    trigger rather than on whichever runner happens to own the listener port;
   *  - owner-less, or owned by THIS runner → {@link fire} it in-process.
   *
   * This is the entry point the HTTP listener calls; {@link fire} stays the
   * in-process executor (used here, by the drain poller, and by `webhook_test`).
   */
  async route(
    trigger: WebhookTrigger,
    prompt: string,
    deliveryId: string | null,
  ): Promise<WebhookRouteOutcome> {
    const owner = trigger.ownerSessionId;
    if (this.opts.queue && owner && owner !== this.opts.ownerSessionId) {
      await this.opts.queue.enqueue({
        triggerId: trigger.id,
        triggerName: trigger.name,
        ownerSessionId: owner,
        prompt,
        deliveryId,
      });
      this.opts.logger?.info?.('webhooks: delivery handed off to owner runner', {
        trigger: trigger.name,
        owner,
      });
      return { handled: 'enqueued', ownerSessionId: owner };
    }
    const outcome = await this.fire(trigger, prompt, deliveryId);
    return { handled: 'fired', outcome };
  }

  async fire(
    trigger: WebhookTrigger,
    prompt: string,
    deliveryId: string | null,
  ): Promise<WebhookFireOutcome> {
    let result: WebhookPromptResult;
    try {
      result = await this.opts.runner.runPrompt({
        prompt,
        allowedTools: trigger.allowedTools,
        ...(trigger.model ? { model: trigger.model } : {}),
        triggerName: trigger.name,
      });
    } catch (err) {
      result = { text: '', error: err instanceof Error ? err.message : String(err) };
    }

    let inboxPath: string | undefined;
    try {
      inboxPath = await writeInbox(trigger, result, deliveryId, this.opts.inbox);
    } catch (err) {
      this.opts.logger?.warn?.('webhooks: inbox write failed', {
        trigger: trigger.name,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await this.opts.store.recordFire(trigger.id, {
        ok: !result.error,
        ...(result.error ? { error: result.error } : {}),
      });
    } catch (err) {
      this.opts.logger?.warn?.('webhooks: store update failed', {
        trigger: trigger.name,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const outcome: WebhookFireOutcome = {
      ok: !result.error,
      text: result.text,
      ...(result.error ? { error: result.error } : {}),
      ...(inboxPath ? { inboxPath } : {}),
    };

    try {
      this.opts.onFired?.(trigger, outcome);
    } catch (err) {
      this.opts.logger?.warn?.('webhooks: onFired hook threw', {
        trigger: trigger.name,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    this.opts.logger?.info?.('webhooks: fired', {
      trigger: trigger.name,
      ok: outcome.ok,
      inbox: outcome.inboxPath,
    });
    return outcome;
  }
}
