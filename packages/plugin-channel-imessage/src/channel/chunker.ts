/**
 * Buffered chunked sends — iMessage's streaming strategy.
 *
 * WHY NOT FramePump edits: editing a sent iMessage requires the BlueBubbles
 * Private API (a Helper bundle injected into Messages, which needs SIP disabled)
 * — out of scope for v1's stock apple-script server. With apple-script every
 * message is immutable once sent, so instead of "send once then edit" we buffer
 * the streamed text and send coherent chunks: nothing goes out until a
 * paragraph-aligned chunk is ready, and the remainder goes out once, at turn
 * end. (Copied from the Signal channel's chunker, which faces the same
 * immutable-message constraint.)
 */

/** Buffered text below this length is held for the final flush. */
export const IMESSAGE_CHUNK_SOFT_LIMIT = 1_500;
/**
 * Never send a single message longer than this. iMessage itself allows long
 * bodies, but clients render extremely long messages poorly; 2000 mirrors the
 * Signal channel's cap for parity.
 */
export const IMESSAGE_CHUNK_HARD_LIMIT = 2_000;

export interface ChunkLimits {
  readonly softLimit?: number;
  readonly hardLimit?: number;
}

/**
 * If `text` has grown past the soft limit, split off one send-ready chunk at
 * the best boundary (paragraph → line → word) at or below the hard limit.
 * Returns null while the text should keep buffering.
 */
export function takeChunk(
  text: string,
  limits: ChunkLimits = {},
): { chunk: string; rest: string } | null {
  const soft = limits.softLimit ?? IMESSAGE_CHUNK_SOFT_LIMIT;
  const hard = limits.hardLimit ?? IMESSAGE_CHUNK_HARD_LIMIT;
  if (text.length <= soft) return null;
  const window = text.slice(0, Math.min(text.length, hard));
  // Prefer a paragraph break; a chunk that ends mid-sentence reads badly as a
  // standalone message. Require the boundary to keep a meaningful chunk (≥ half
  // the soft limit) so a leading blank line can't produce confetti.
  const minCut = Math.floor(soft / 2);
  for (const boundary of ['\n\n', '\n', ' ']) {
    const at = window.lastIndexOf(boundary);
    if (at >= minCut) {
      return { chunk: window.slice(0, at).trimEnd(), rest: text.slice(at + boundary.length) };
    }
  }
  if (text.length <= hard) return null; // no boundary yet — wait for more text
  return { chunk: window, rest: text.slice(window.length) }; // pathological: hard cut
}

/** Split a final remainder into hard-limit-sized pieces at the best boundaries. */
export function splitForImessage(text: string, limits: ChunkLimits = {}): string[] {
  const hard = limits.hardLimit ?? IMESSAGE_CHUNK_HARD_LIMIT;
  const parts: string[] = [];
  let rest = text;
  while (rest.length > hard) {
    // Reuse takeChunk with soft==hard-ish so it only splits when forced.
    const taken = takeChunk(rest, { softLimit: Math.floor(hard / 2), hardLimit: hard });
    if (!taken) break;
    if (taken.chunk) parts.push(taken.chunk);
    rest = taken.rest;
  }
  const tail = rest.trim();
  if (tail) parts.push(tail);
  return parts;
}

export interface ChunkedSenderOptions {
  /** Deliver one message. Errors should be handled by the caller-supplied fn
   *  (log + swallow) — a failed chunk must never abort the turn. */
  readonly send: (text: string) => Promise<void>;
  readonly limits?: ChunkLimits;
}

/**
 * Drives {@link takeChunk} over a GROWING renderer snapshot: `offer()` on every
 * change (sends any ready chunk), `finalize()` at turn end (sends the
 * remainder, or `emptyText` when the whole turn produced nothing). Sends are
 * serialized on an internal queue so chunks can never interleave out of order.
 */
export class ChunkedSender {
  private readonly opts: ChunkedSenderOptions;
  /** The exact snapshot prefix already delivered (chunk boundaries included). */
  private sentPrefix = '';
  private sentAnything = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: ChunkedSenderOptions) {
    this.opts = opts;
  }

  /** Called with the current full snapshot whenever it changes. */
  offer(snapshot: string): void {
    this.queue = this.queue.then(async () => {
      // Streamed text only ever grows; if the snapshot diverged from what we
      // already delivered (the final assistant_message rewrote history) hold
      // everything for finalize(), which handles divergence explicitly.
      if (!snapshot.startsWith(this.sentPrefix)) return;
      let consumed = this.sentPrefix.length;
      let taken = takeChunk(snapshot.slice(consumed), this.opts.limits);
      while (taken) {
        await this.deliver(taken.chunk);
        consumed = snapshot.length - taken.rest.length;
        this.sentPrefix = snapshot.slice(0, consumed);
        taken = takeChunk(taken.rest, this.opts.limits);
      }
    });
  }

  /**
   * Turn end: deliver whatever the final snapshot still owes. When the final
   * text no longer extends what we already sent (a divergent final frame —
   * rare), send the full final text so the user always receives the
   * authoritative reply, accepting the duplication.
   */
  async finalize(snapshot: string, emptyText?: string): Promise<void> {
    this.queue = this.queue.then(async () => {
      const finalText = snapshot.trim();
      if (!finalText) {
        if (!this.sentAnything && emptyText) await this.deliver(emptyText);
        return;
      }
      const remainder = snapshot.startsWith(this.sentPrefix)
        ? snapshot.slice(this.sentPrefix.length)
        : snapshot; // diverged: resend the authoritative text in full
      for (const part of splitForImessage(remainder, this.opts.limits)) {
        await this.deliver(part);
      }
      this.sentPrefix = snapshot;
    });
    await this.queue;
  }

  private async deliver(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.sentAnything = true;
    await this.opts.send(trimmed);
  }
}
