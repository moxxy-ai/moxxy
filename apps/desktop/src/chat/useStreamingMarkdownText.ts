import { useEffect, useRef, useState } from 'react';

/** Fastest a growing message is re-parsed while it streams. Twelve times a
 *  second reads as continuous text and collapses every delta in between. */
export const STREAMING_PARSE_INTERVAL_MS = 80;
/** Slowest, for a message long enough that each parse is expensive on its own. */
export const STREAMING_PARSE_MAX_INTERVAL_MS = 1_000;
/** Characters per millisecond of interval. Re-parsing costs roughly linear time
 *  in the message length, so holding length/interval constant keeps the SHARE
 *  of the renderer spent parsing flat instead of growing with the answer. */
const CHARS_PER_INTERVAL_MS = 40;

/**
 * How long to wait before re-parsing a message of this length.
 *
 * A streaming message is re-parsed in full on every update, so a fixed interval
 * still costs time proportional to length × updates — quadratic over a turn,
 * and a 150s profile of one long answer showed markdown and micromark pegging
 * the renderer. Stretching the interval as the message grows bounds that.
 */
export function resolveStreamingParseInterval(length: number): number {
  const safeLength = Number.isFinite(length) ? Math.max(0, length) : 0;
  return Math.min(
    STREAMING_PARSE_MAX_INTERVAL_MS,
    Math.max(STREAMING_PARSE_INTERVAL_MS, safeLength / CHARS_PER_INTERVAL_MS),
  );
}

/**
 * The text to actually hand to the Markdown parser.
 *
 * A streaming message is re-parsed IN FULL on every delta, so the cost of a
 * turn grows with the square of its length — and a CPU profile of a live turn
 * put react-markdown, remark-gfm and micromark at ~13% of the renderer with the
 * transcript already memoised. Deltas arrive far faster than anyone can read,
 * so this collapses the ones that land inside a single interval into one parse.
 *
 * The final text is never throttled: when `streaming` goes false the latest
 * value is published immediately, so a finished message is always complete and
 * a non-streaming caller is unaffected.
 */
export function useStreamingMarkdownText(
  text: string,
  streaming: boolean,
  intervalMs?: number,
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
    const wait = intervalMs ?? resolveStreamingParseInterval(text.length);
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(latest.current);
    }, Math.max(0, wait));
  }, [text, streaming, intervalMs]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  return shown;
}
