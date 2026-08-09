import { useEffect, useRef, useState, type MutableRefObject } from 'react';

/** Fastest a growing message is re-parsed while it streams. Twelve times a
 *  second reads as continuous text and collapses every delta in between. */
export const STREAMING_PARSE_INTERVAL_MS = 80;
/** Slowest, so a very long answer still visibly advances while it is written. */
export const STREAMING_PARSE_MAX_INTERVAL_MS = 1_500;
/**
 * How much thread time a parse is allowed to claim: one part parsing to four
 * parts everything else, so Markdown can take at most a fifth of the renderer
 * however large the message gets.
 */
const PARSE_BUDGET_RATIO = 5;

/**
 * How long to wait before re-parsing, given what the last parse actually cost.
 *
 * Throttling by a fixed interval bounds how OFTEN we parse but not how much
 * each parse costs, and a single parse of a long answer is expensive on its own
 * — a profile of a 300-item list mid-stream still had Markdown at half the
 * window with a fixed interval in place. Guessing from the character count was
 * no better: cost depends on structure, and three hundred list items are far
 * dearer than the same characters of prose.
 *
 * So the interval is derived from the measured cost of the previous parse. If a
 * parse takes 200ms the next one is 1000ms away, and Markdown settles at a
 * fifth of the thread no matter how the answer is shaped.
 */
export function resolveStreamingParseInterval(lastParseMs: number): number {
  const cost = Number.isFinite(lastParseMs) ? Math.max(0, lastParseMs) : 0;
  return Math.min(
    STREAMING_PARSE_MAX_INTERVAL_MS,
    Math.max(STREAMING_PARSE_INTERVAL_MS, cost * PARSE_BUDGET_RATIO),
  );
}

/**
 * The text to actually hand to the Markdown parser.
 *
 * The final text is never throttled: when `streaming` goes false the latest
 * value is published immediately, so a finished message is always complete and
 * a non-streaming caller is unaffected.
 */
export function useStreamingMarkdownText(
  text: string,
  streaming: boolean,
  lastParseMs?: MutableRefObject<number>,
): string {
  const [shown, setShown] = useState(text);
  const latest = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = text;

  useEffect(() => {
    if (!streaming) {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setShown(text);
      return;
    }
    // A tick is already scheduled: this delta rides along with it rather than
    // buying a parse of its own.
    if (timer.current !== null) return;
    const wait = resolveStreamingParseInterval(lastParseMs?.current ?? 0);
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(latest.current);
    }, wait);
  }, [text, streaming, lastParseMs]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  return shown;
}
