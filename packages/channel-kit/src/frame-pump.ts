/**
 * Throttled "send once, then edit one message" streaming loop — the shared core
 * behind the Telegram and Slack frame pumps. The channel feeds it "something
 * changed" signals (`scheduleEdit`); the pump pulls the current frame text from
 * the `frame` callback at flush time and drives a tiny messenger-agnostic
 * {@link FrameSink} (`send` a new message, `edit` an existing one).
 *
 * Lifecycle per turn:
 *   1. construct with a sink bound to the turn's target (chat / thread).
 *   2. `scheduleEdit()` whenever the rendered snapshot changes → debounced
 *      `flush(false)` after `editFrameMs`.
 *   3. `flush(true)` on turn completion drains the final snapshot (and posts
 *      `emptyFinalText` when the turn rendered nothing at all).
 *   4. `dispose()` clears the timer.
 *
 * Messenger-specific concerns stay in the sink: Telegram's HTML parse-mode
 * fallback and 4096-char message splitting, Slack's `chat.postMessage` /
 * `chat.update` calls. The `final` flag is forwarded so a sink can perform
 * final-only work (Telegram sends split-overflow tails only on the last frame).
 */

/** Messenger adapter the pump drives. Implementations should swallow their own
 *  transport errors (log + return null / resolve) — a failed frame must never
 *  abort the turn. */
export interface FrameSink<Id> {
  /** Send a NEW message; returns its id, or null when the send failed. */
  send(text: string, final: boolean): Promise<Id | null>;
  /** Edit a previously sent message in place. */
  edit(id: Id, text: string, final: boolean): Promise<void>;
}

export interface FramePumpOptions<Id> {
  readonly sink: FrameSink<Id>;
  /** Debounce window for streaming edits (typically ~1s). */
  readonly editFrameMs: number;
  /**
   * Produce the current frame text. Called at flush time (pull model) so the
   * flushed frame always reflects the newest renderer state; `final` lets a
   * renderer emit a different last frame (e.g. Telegram collapses its activity
   * trace only on the final flush). An empty string means "nothing to show".
   */
  readonly frame: (final: boolean) => string;
  /**
   * Sent when the FINAL flush finds no content and no message was ever sent,
   * so the user isn't left staring at a placeholder-less turn. Omit to skip.
   */
  readonly emptyFinalText?: string;
  /**
   * Deliver the final frame to the sink even when its text is identical to the
   * last sent frame. Channels whose sink does final-only work that must not be
   * skipped (Telegram's split tails) set this; channels where the final frame
   * is a plain re-send (Slack) leave it off and save the no-op API call.
   */
  readonly alwaysFlushFinal?: boolean;
}

export class FramePump<Id> {
  private readonly opts: FramePumpOptions<Id>;
  private id: Id | null = null;
  private lastSent = '';
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  /** In-flight send/edit, so timer + flush never overlap (single-flight). */
  private inflight: Promise<void> | null = null;

  constructor(opts: FramePumpOptions<Id>) {
    this.opts = opts;
  }

  /** The id of the streamed message once sent (null until the first frame lands). */
  get messageId(): Id | null {
    return this.id;
  }

  /** Debounced "content changed" signal → `flush(false)` after `editFrameMs`. */
  scheduleEdit(): void {
    if (this.editTimer || this.inflight) return;
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      void this.flush(false);
    }, this.opts.editFrameMs);
  }

  /**
   * Drain the current frame to the sink. The first non-empty frame `send`s a
   * new message; every later frame `edit`s it in place. A `final` flush is
   * never dropped: if a send is in flight it waits for it, and it guarantees
   * at least one message (via `emptyFinalText`) when the turn rendered nothing.
   */
  async flush(final: boolean): Promise<void> {
    this.cancelTimer();
    if (this.inflight) {
      if (!final) {
        // A send is running; re-arm so the newest text lands after it.
        if (this.opts.frame(false) !== this.lastSent) this.scheduleEdit();
        return;
      }
      // Final flushes must not be lost — wait out the in-flight send.
      await this.inflight;
    }
    const text = this.opts.frame(final);
    if (!text) {
      if (final && this.id == null && this.opts.emptyFinalText) {
        const placeholder = this.opts.emptyFinalText;
        await this.track(async () => {
          const sent = await this.opts.sink.send(placeholder, final);
          if (sent != null) this.id = sent;
        });
      }
      return;
    }
    if (text === this.lastSent && !(final && this.opts.alwaysFlushFinal)) return;
    await this.track(async () => {
      if (this.id == null) {
        const sent = await this.opts.sink.send(text, final);
        if (sent != null) this.id = sent;
      } else {
        await this.opts.sink.edit(this.id, text, final);
      }
      this.lastSent = text;
    });
    // Content may have advanced while the send was in flight.
    if (final) {
      if (this.opts.frame(true) !== this.lastSent) await this.flush(true);
    } else if (this.opts.frame(false) !== this.lastSent) {
      this.scheduleEdit();
    }
  }

  dispose(): void {
    this.cancelTimer();
  }

  private async track(work: () => Promise<void>): Promise<void> {
    const run = work();
    // Waiters must never observe a rejection here; errors propagate to the
    // caller of `flush` below (sinks are expected to swallow transport errors).
    this.inflight = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      await run;
    } finally {
      this.inflight = null;
    }
  }

  private cancelTimer(): void {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
  }
}
