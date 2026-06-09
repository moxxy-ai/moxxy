import {
  computeElisionState,
  conversationalStub,
  conversationalStubbed,
  toolResultBytes,
  toolResultStub,
  toolResultStubbed,
} from '@moxxy/sdk';
import type { EventLogReader, MoxxyEvent } from '@moxxy/sdk';

/**
 * Incrementally-cached context estimate for the TUI.
 *
 * The SDK's `estimateContextTokens` re-walks the entire event log (including a
 * `JSON.stringify` of every tool result) on every call. The TUI calls it from
 * `SessionView`'s render path, which runs at ~30Hz while a response streams —
 * an O(log × renders) cost that grows with the conversation. This wrapper
 * keeps the same result (asserted against the SDK implementation in tests)
 * but caches the running character total per log:
 *
 *   - unchanged log   → cache hit, no per-event work at all
 *   - appended events → fold in ONLY the new events
 *   - clear/reset (`session.reset`, `/new`, a runner re-sync) → detected via
 *     the first/last event ids (event ids are unique and never reused, so a
 *     wiped-and-regrown log can't alias a stale entry) → full re-walk
 *
 * Folding is only sound while new events can't change the contribution of OLD
 * events. Three event kinds can: `elision` (moves the high-water mark),
 * `compaction` (replaces a past range with a summary), and a `recall` tool
 * call (rewrites the stub text of the recalled result and can flip the
 * adaptive conversational-elision switch). Any of those — or an out-of-order
 * seq — falls back to the full walk, which is exactly the SDK algorithm.
 */

/** Per-event character contribution — mirror of the SDK's private `eventChars`
 *  (stub decisions are layered on top via the shared elision-state helpers).
 *  Exported (and injectable) so tests can spy on the expensive walk. */
export function eventChars(e: MoxxyEvent): number {
  switch (e.type) {
    case 'user_prompt': {
      let n = e.text.length;
      // Inlined text attachments cost real prompt tokens; image/document
      // base64 is tokenized specially by providers, so don't char-count it.
      for (const att of e.attachments ?? []) {
        if (att.kind === 'file' || att.kind === 'stdin') n += att.content.length;
      }
      return n;
    }
    case 'assistant_message':
      return e.content.length;
    case 'tool_call_requested':
      return e.name.length + safeJsonLen(e.input);
    case 'tool_result':
      if (e.error) return (e.error.message?.length ?? 0) + 12;
      if (typeof e.output === 'string') return e.output.length;
      return safeJsonLen(e.output);
    default:
      return 0;
  }
}

function safeJsonLen(v: unknown): number {
  try {
    return JSON.stringify(v ?? '').length;
  } catch {
    return 0;
  }
}

interface CacheEntry {
  /** How many events have been folded into `chars`. */
  count: number;
  /** Identity of the folded prefix — unique event ids, so a cleared-and-
   *  regrown log (same length, fresh events) never aliases a stale entry. */
  firstId: string;
  lastId: string;
  /** Running character total (token estimate = ceil(chars / 4)). */
  chars: number;
  /** Highest seq any cached per-event decision depends on (last seq, elision
   *  HWM, compaction range ends). A new event at or below it → full re-walk. */
  guardSeq: number;
}

const cache = new WeakMap<EventLogReader, CacheEntry>();

/** True when appending `fresh` can't change the cached contribution of any
 *  earlier event — i.e. the running total can be extended incrementally. */
function foldable(fresh: ReadonlyArray<MoxxyEvent>, guardSeq: number): boolean {
  for (const e of fresh) {
    if (e.type === 'elision' || e.type === 'compaction') return false;
    if (e.type === 'tool_call_requested' && e.name === 'recall') return false;
    if (e.seq <= guardSeq) return false;
  }
  return true;
}

export function estimateContextTokens(
  log: EventLogReader,
  opts: { readonly perEventChars?: (e: MoxxyEvent) => number } = {},
): number {
  const per = opts.perEventChars ?? eventChars;
  const len = log.length;
  if (len === 0) {
    cache.delete(log); // a wiped log must not leave a stale prefix behind
    return 0;
  }

  const entry = cache.get(log);
  const prefixIntact =
    entry !== undefined &&
    entry.count <= len &&
    log.at(0)?.id === entry.firstId &&
    log.at(entry.count - 1)?.id === entry.lastId;

  if (prefixIntact) {
    if (entry.count === len) return Math.ceil(entry.chars / 4); // unchanged → no walk
    const fresh = log.slice(entry.count);
    if (foldable(fresh, entry.guardSeq)) {
      let chars = entry.chars;
      let guardSeq = entry.guardSeq;
      for (const e of fresh) {
        chars += per(e);
        if (e.seq > guardSeq) guardSeq = e.seq;
      }
      const last = fresh[fresh.length - 1]!;
      cache.set(log, { count: len, firstId: entry.firstId, lastId: String(last.id), chars, guardSeq });
      return Math.ceil(chars / 4);
    }
  }

  return fullWalk(log, per);
}

/**
 * The SDK `estimateContextTokens` algorithm, verbatim, plus cache bookkeeping:
 * compaction ranges count as their summary, old tool results / conversational
 * turns count as their stubs (shared decision helpers), everything else goes
 * through the per-event estimator.
 */
function fullWalk(log: EventLogReader, per: (e: MoxxyEvent) => number): number {
  const events = log.slice();
  const el = computeElisionState(events);
  let chars = 0;
  let guardSeq = el.hwm;
  const compactedSeqs = new Set<number>();
  for (const e of events) {
    if (e.seq > guardSeq) guardSeq = e.seq;
    if (e.type === 'compaction') {
      for (let seq = e.replacedRange[0]; seq <= e.replacedRange[1]; seq++) {
        compactedSeqs.add(seq);
      }
      if (e.replacedRange[1] > guardSeq) guardSeq = e.replacedRange[1];
      chars += e.summary.length;
    }
  }
  for (const e of events) {
    if (compactedSeqs.has(e.seq)) continue;
    if (e.type === 'tool_result' && toolResultStubbed(e, el)) {
      const recalled = el.recalledCallIds.has(e.callId) || el.recalledSeqs.has(e.seq);
      chars += toolResultStub(e.callId, toolResultBytes(e.output), recalled).length;
      continue;
    }
    if ((e.type === 'user_prompt' || e.type === 'assistant_message') && conversationalStubbed(e, el)) {
      chars += conversationalStub(e.type === 'user_prompt' ? 'user' : 'assistant', e.seq).length;
      continue;
    }
    chars += per(e);
  }
  const first = events[0]!;
  const last = events[events.length - 1]!;
  cache.set(log, {
    count: events.length,
    firstId: String(first.id),
    lastId: String(last.id),
    chars,
    guardSeq,
  });
  return Math.ceil(chars / 4);
}
