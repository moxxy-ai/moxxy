import type { SlackClient } from './slack-client.js';

export interface FramePumpLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface FramePumpOptions {
  readonly client: SlackClient;
  readonly channel: string;
  /** Thread to reply under (`event.thread_ts ?? event.ts`). */
  readonly threadTs: string;
  /** Debounce window for `chat.update` edits (~1s). */
  readonly editFrameMs: number;
  readonly logger?: FramePumpLogger;
}

/**
 * Drives the throttled "post once, then edit a single message" streaming loop
 * for a Slack turn — the Slack analog of Telegram's FramePump. The turn-runner
 * feeds it the latest snapshot; the pump posts a placeholder on the first real
 * content (lazily, via `chat.postMessage`) and edits THAT message via
 * `chat.update` for every subsequent frame, throttled to `editFrameMs`.
 *
 * Lifecycle per turn:
 *   1. construct with `{ client, channel, threadTs }`.
 *   2. `setText(latest)` whenever the rendered snapshot changes → schedules an
 *      edit.
 *   3. `flush(final=true)` on turn completion drains the final snapshot.
 *   4. `dispose()` clears the timer.
 */
export class FramePump {
  private readonly client: SlackClient;
  private readonly channel: string;
  private readonly threadTs: string;
  private readonly editFrameMs: number;
  private readonly logger: FramePumpLogger | undefined;

  private messageTs: string | null = null;
  private latest = '';
  private lastSent = '';
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while a post/update is in flight, so timer + flush never overlap. */
  private sending = false;

  constructor(opts: FramePumpOptions) {
    this.client = opts.client;
    this.channel = opts.channel;
    this.threadTs = opts.threadTs;
    this.editFrameMs = opts.editFrameMs;
    this.logger = opts.logger;
  }

  /** The ts of the streamed message once posted (lets the runner know it exists). */
  get postedTs(): string | null {
    return this.messageTs;
  }

  /** Record the latest rendered text and schedule a throttled edit. */
  setText(text: string): void {
    this.latest = text;
    this.scheduleEdit();
  }

  private scheduleEdit(): void {
    if (this.editTimer || this.sending) return;
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      void this.flush(false);
    }, this.editFrameMs);
  }

  /**
   * Drain the latest snapshot to Slack. On the first non-empty frame, posts a
   * new threaded message; afterwards edits it in place. `final` guarantees at
   * least one message even when the turn produced no streamed text.
   */
  async flush(final: boolean): Promise<void> {
    this.cancelTimer();
    if (this.sending) {
      // A flush is already running; re-arm so the newest text is sent after it.
      if (this.latest !== this.lastSent) this.scheduleEdit();
      return;
    }
    const text = this.latest.trim();
    if (!text) {
      if (final && this.messageTs == null) {
        await this.post('_(no output)_');
      }
      return;
    }
    if (text === this.lastSent) return;

    this.sending = true;
    try {
      if (this.messageTs == null) {
        await this.post(text);
      } else {
        await this.edit(this.messageTs, text);
      }
      this.lastSent = text;
    } finally {
      this.sending = false;
    }
    // If new text arrived while we were sending, schedule another edit.
    if (final) {
      if (this.latest.trim() !== this.lastSent) await this.flush(true);
    } else if (this.latest.trim() !== this.lastSent) {
      this.scheduleEdit();
    }
  }

  private async post(text: string): Promise<void> {
    try {
      const res = await this.client.postMessage({
        channel: this.channel,
        text,
        threadTs: this.threadTs,
      });
      this.messageTs = res.ts;
    } catch (err) {
      this.logger?.warn?.('slack chat.postMessage failed', { err: String(err) });
    }
  }

  private async edit(ts: string, text: string): Promise<void> {
    try {
      await this.client.updateMessage({ channel: this.channel, ts, text });
    } catch (err) {
      this.logger?.warn?.('slack chat.update failed', { err: String(err) });
    }
  }

  dispose(): void {
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
  }
}
