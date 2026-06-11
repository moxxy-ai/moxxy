/**
 * Per-actor speech-bubble channel. Streaming deltas accumulate and surface as
 * the trailing piece of text, throttled so the bubble re-renders at most
 * every 600ms; one-shot say() bubbles (tool/alert/final) override streaming
 * for their ttl, then streaming resumes if still fresh.
 */

import type { BubbleTone } from './types.js';

export interface BubbleState {
  readonly text: string;
  readonly tone: BubbleTone;
}

const STREAM_THROTTLE_MS = 600;
const STREAM_TTL_MS = 3000;
const SAY_TTL_MS = 2500;
const TAIL_MAX_CHARS = 80;

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The visible streaming snippet: text after the last sentence boundary
 * (. ! ? followed by space/end), or the last 80 chars when no boundary
 * yields a non-empty tail.
 */
export function trailingPiece(raw: string): string {
  const text = collapseWhitespace(raw);
  const re = /[.!?](?=\s|$)/g;
  const cuts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) cuts.push(m.index);
  for (let i = cuts.length - 1; i >= 0; i--) {
    const tail = text.slice(cuts[i] + 1).trim();
    if (tail.length > 0) return tail.slice(-TAIL_MAX_CHARS);
  }
  return text.slice(-TAIL_MAX_CHARS);
}

/** First sentence of `raw`, capped at `maxLen` chars (ellipsized). */
export function firstSentence(raw: string, maxLen = 80): string {
  const text = collapseWhitespace(raw);
  const m = /[.!?](?=\s|$)/.exec(text);
  const s = m ? text.slice(0, m.index + 1) : text;
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
}

export class BubbleChannel {
  private buf = '';
  private lastPushMs = Number.NEGATIVE_INFINITY;
  private visible: string | null = null;
  private lastEmitMs = Number.NEGATIVE_INFINITY;
  private sayState: { text: string; tone: BubbleTone; untilMs: number } | null = null;

  /** Streaming text accumulates; the bubble expires 3000ms after the last push. */
  push(delta: string, nowMs: number): void {
    this.buf += delta;
    this.lastPushMs = nowMs;
  }

  /** Immediate one-shot bubble; overrides streaming display for its ttl. */
  say(text: string, tone: BubbleTone, nowMs: number, ttlMs = SAY_TTL_MS): void {
    this.sayState = { text, tone, untilMs: nowMs + ttlMs };
  }

  current(nowMs: number): BubbleState | null {
    if (this.sayState) {
      if (nowMs < this.sayState.untilMs) {
        return { text: this.sayState.text, tone: this.sayState.tone };
      }
      this.sayState = null;
    }
    if (this.buf.length === 0 || nowMs - this.lastPushMs > STREAM_TTL_MS) return null;
    if (this.visible === null || nowMs - this.lastEmitMs >= STREAM_THROTTLE_MS) {
      this.visible = trailingPiece(this.buf);
      this.lastEmitMs = nowMs;
    }
    return this.visible.length > 0 ? { text: this.visible, tone: 'speech' } : null;
  }

  clear(): void {
    this.buf = '';
    this.visible = null;
    this.sayState = null;
    this.lastPushMs = Number.NEGATIVE_INFINITY;
    this.lastEmitMs = Number.NEGATIVE_INFINITY;
  }
}
