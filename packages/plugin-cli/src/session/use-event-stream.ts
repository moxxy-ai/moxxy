import React, { useEffect, useRef, useState } from 'react';
import type { MoxxyEvent, ClientSession as Session } from '@moxxy/sdk';

/**
 * High-water cap on the in-renderer event window. `events` is the live render
 * source for the chat; older history is in the persisted log/scrollback, so a
 * very long session doesn't need every event retained in memory. tool_result
 * events can carry large payloads, so an uncapped array climbs steadily over
 * hundreds of turns. We keep the most recent slice and drop the oldest once
 * the cap is exceeded — large enough that ordinary tool/result pairing within
 * a turn is never split across the boundary.
 */
const MAX_RENDERED_EVENTS = 5_000;

/**
 * The events to seed the renderer with when (re)subscribing to a session: the
 * history the log ALREADY holds, minus the live-only chunk types (never
 * persisted, never rendered) and tail-capped to the same in-memory window as
 * the live append path.
 *
 * This is what makes a resumed or switched-to session show its prior messages.
 * On `/sessions` switch / `--resume`, `bootSession` seeds the new `EventLog`
 * directly, which intentionally does NOT fire subscribers — so a fresh
 * `useEventStream` that only listened for future appends rendered an empty body
 * while the status line (which reads the full `log`) showed the correct token
 * count. Seeding from the held log closes that gap.
 */
export function seedFromLog(log: Pick<Session['log'], 'toJSON'>): ReadonlyArray<MoxxyEvent> {
  const held = log
    .toJSON()
    .filter((e) => e.type !== 'assistant_chunk' && e.type !== 'reasoning_chunk');
  return held.length > MAX_RENDERED_EVENTS
    ? held.slice(held.length - MAX_RENDERED_EVENTS)
    : held;
}

export interface EventStreamHandle {
  events: ReadonlyArray<MoxxyEvent>;
  setEvents: React.Dispatch<React.SetStateAction<ReadonlyArray<MoxxyEvent>>>;
  streamingDelta: string;
  setStreamingDelta: React.Dispatch<React.SetStateAction<string>>;
  streamingBufferRef: React.MutableRefObject<string>;
  /** Live (un-persisted) thinking stream, throttled like `streamingDelta`. */
  reasoningDelta: string;
  setReasoningDelta: React.Dispatch<React.SetStateAction<string>>;
  reasoningBufferRef: React.MutableRefObject<string>;
  /** Cancel any pending flush (used on /clear, /new, manual resets). */
  cancelStreamFlush: () => void;
}

/**
 * Subscribes to the session event log + throttles assistant_chunk
 * deltas. Some providers ship chunks 100×/s; without throttling each
 * one re-renders the entire markdown body. A ~30fps update cadence is
 * indistinguishable from chunk-frequency typing but keeps Ink's render
 * pipeline calm.
 */
export function useEventStream(session: Session): EventStreamHandle {
  const [events, setEvents] = useState<ReadonlyArray<MoxxyEvent>>([]);
  const [streamingDelta, setStreamingDelta] = useState('');
  const streamingBufferRef = useRef('');
  const streamFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reasoningDelta, setReasoningDelta] = useState('');
  const reasoningBufferRef = useRef('');
  const reasoningFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleStreamFlush = React.useCallback(() => {
    if (streamFlushRef.current) return;
    streamFlushRef.current = setTimeout(() => {
      streamFlushRef.current = null;
      setStreamingDelta(streamingBufferRef.current);
    }, 33);
  }, []);

  const scheduleReasoningFlush = React.useCallback(() => {
    if (reasoningFlushRef.current) return;
    reasoningFlushRef.current = setTimeout(() => {
      reasoningFlushRef.current = null;
      setReasoningDelta(reasoningBufferRef.current);
    }, 33);
  }, []);

  const cancelStreamFlush = React.useCallback(() => {
    if (streamFlushRef.current) {
      clearTimeout(streamFlushRef.current);
      streamFlushRef.current = null;
    }
    if (reasoningFlushRef.current) {
      clearTimeout(reasoningFlushRef.current);
      reasoningFlushRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      // Component unmount: cancel any pending streaming flush so we
      // don't try to setState on an unmounted tree.
      cancelStreamFlush();
    };
  }, [cancelStreamFlush]);

  useEffect(() => {
    // Seed from the history the log already holds before subscribing. Seeded
    // EventLog events don't fire subscribers, so on a session switch / resume
    // the body would otherwise render empty. Runs in the same synchronous tick
    // as subscribe(), so no live append can interleave/duplicate; a fresh
    // session's log is empty, leaving first-boot behavior unchanged.
    setEvents(seedFromLog(session.log));
    const unsub = session.log.subscribe((event) => {
      // assistant_chunk events fire at provider-stream cadence (often
      // hundreds per turn). Don't push them into `events` — they render
      // to null in EventLine anyway, but every push triggers
      // `pairToolEvents` to re-walk the growing array (O(n²) over the
      // turn). The live buffer + throttled setState handles display.
      if (event.type === 'assistant_chunk') {
        streamingBufferRef.current += event.delta;
        scheduleStreamFlush();
        return;
      }
      // reasoning_chunk mirrors assistant_chunk: a high-frequency live
      // thinking stream that never enters `events` (it isn't persisted).
      // Buffer + throttle it onto its own delta.
      if (event.type === 'reasoning_chunk') {
        reasoningBufferRef.current += event.delta;
        scheduleReasoningFlush();
        return;
      }
      setEvents((prev) => {
        const next = [...prev, event];
        // Bound the in-memory window: drop the oldest events once past the
        // high-water mark so a long-running session doesn't retain the full
        // conversation (incl. large tool_result payloads) in renderer memory.
        return next.length > MAX_RENDERED_EVENTS
          ? next.slice(next.length - MAX_RENDERED_EVENTS)
          : next;
      });
      if (event.type === 'assistant_message' || event.type === 'reasoning_message') {
        // Cancel any pending flush — the message is in `events` now,
        // so leaving the streaming delta visible would double-render.
        // The finalized reasoning_message (persisted) supersedes the
        // live thinking stream, so clear that too here; assistant_message
        // ends the turn and clears both.
        cancelStreamFlush();
        reasoningBufferRef.current = '';
        setReasoningDelta('');
      }
      if (event.type === 'assistant_message') {
        streamingBufferRef.current = '';
        setStreamingDelta('');
      }
    });
    return unsub;
  }, [session, scheduleStreamFlush, scheduleReasoningFlush, cancelStreamFlush]);

  return {
    events,
    setEvents,
    streamingDelta,
    setStreamingDelta,
    streamingBufferRef,
    reasoningDelta,
    setReasoningDelta,
    reasoningBufferRef,
    cancelStreamFlush,
  };
}
