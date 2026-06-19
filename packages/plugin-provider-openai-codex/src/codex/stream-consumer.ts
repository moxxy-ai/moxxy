import { toFriendlyError, type ProviderEvent, type StopReason } from '@moxxy/sdk';
import { handleSseEvent } from './sse-event-handler.js';
import { CODEX_RESPONSES_URL } from '../oauth.js';
import { parseToolArgs, type PendingFunctionCall, type ResponsesSseEvent } from './stream-types.js';

export function toErrorEvent(err: unknown): ProviderEvent {
  return {
    type: 'error',
    ...toFriendlyError(err, { provider: 'openai-codex', url: CODEX_RESPONSES_URL }),
  };
}

// Hard cap on the unparsed reassembly buffer. A misbehaving/MITM'd endpoint (or
// a wedged proxy emitting a continuous body with no blank-line frame separator)
// would otherwise grow `buffer` without bound until OOM, since it's only ever
// truncated when a separator is found. 8 MiB is far larger than any legitimate
// single SSE frame; exceeding it with no separator is treated as a hostile stream.
const MAX_SSE_BUFFER_BYTES = 8 * 1024 * 1024;

export async function* consumeResponsesSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  emitReasoning = false,
  // Called on every successful body read so the caller can reset an idle
  // watchdog (a stalled stream that stops sending bytes must not hang forever).
  onActivity?: () => void,
): AsyncIterable<ProviderEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const pending = new Map<string, PendingFunctionCall>();
  let stopReason: StopReason = 'end_turn';
  let usageIn = 0;
  let usageOut = 0;
  let usageCacheRead = 0;
  // Tracks whether ANY tool_use_end was yielded during the stream.
  // The Responses API's `response.completed` event doesn't differentiate
  // text-only vs tool-use turns, so without this we'd report end_turn
  // even when tools were requested — the upstream tool-use loop would
  // then drop the calls without executing them.
  let sawToolCall = false;
  // Set when an error frame (response.failed/error) surfaced the failure, so
  // we don't also flush tool calls / emit a normal message_end on top of it.
  let errored = false;

  try {
    try {
      outer: while (true) {
        if (signal?.aborted) {
          yield { type: 'error', message: 'aborted', retryable: false };
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        onActivity?.();
        buffer += decoder.decode(value, { stream: true });

        // Bound the unparsed buffer: if it grows past the cap without yielding a
        // single complete frame, the peer is feeding us an unframed/oversized
        // body. Bail rather than accumulate to OOM. (The `finally` cancels the
        // reader so the socket is released.)
        if (buffer.length > MAX_SSE_BUFFER_BYTES) {
          yield {
            type: 'error',
            message: 'Codex stream frame exceeded size limit',
            retryable: false,
          };
          return;
        }

        // SSE frames are separated by blank lines. Some servers emit \r\n\r\n;
        // match either form at the separator and line boundaries rather than
        // rescanning the whole accumulated buffer with a global CRLF replace on
        // every chunk. A `\r` split across two reads is handled because the
        // boundary regexes tolerate the optional `\r`.
        let m: RegExpExecArray | null;
        const sepRe = /\r?\n\r?\n/g;
        while ((m = sepRe.exec(buffer)) !== null) {
          const frame = buffer.slice(0, m.index);
          buffer = buffer.slice(m.index + m[0].length);
          sepRe.lastIndex = 0;
          for (const line of frame.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trimStart();
            if (!payload || payload === '[DONE]') continue;

            let json: ResponsesSseEvent;
            try {
              json = JSON.parse(payload) as ResponsesSseEvent;
            } catch {
              continue;
            }
            const result = handleSseEvent(json, pending, emitReasoning);
            if (result.events) {
              for (const ev of result.events) {
                if (ev.type === 'tool_use_end') sawToolCall = true;
                if (ev.type === 'error') errored = true;
                yield ev;
              }
            }
            if (result.stopReason) stopReason = result.stopReason;
            if (result.usage) {
              usageIn = result.usage.input ?? usageIn;
              usageOut = result.usage.output ?? usageOut;
              usageCacheRead = result.usage.cacheRead ?? usageCacheRead;
            }
            // Terminal frame (response.completed / failed / error): stop
            // consuming. Honoring this prevents a failed turn from emitting
            // both an `error` AND a trailing `message_end`, and ignores any
            // stray frames after completion.
            if (result.terminal) break outer;
          }
        }
      }
    } catch (err) {
      yield toErrorEvent(err);
      return;
    }

    // The error frame already surfaced the failure; nothing more to emit. Drop
    // any pending function calls so a later code path can't flush a phantom
    // tool_use on top of a failed turn — the error supersedes them.
    if (errored) {
      pending.clear();
      return;
    }

    // Flush any tool_call_end events that didn't have a matching .done frame
    // (defensive — the server normally sends function_call.done, but a
    // truncated stream shouldn't drop the entire tool-use sequence).
    for (const entry of pending.values()) {
      const outId = entry.callId || entry.id;
      // If we have a name but never emitted the start (server sent args.delta
      // for an item whose .added carried no name, then truncated before .done),
      // emit the start first — mirrors the .done branch — so the call isn't
      // dropped just because its start frame never landed.
      if (!entry.emittedStart && entry.name) {
        entry.emittedStart = true;
        yield { type: 'tool_use_start', id: outId, name: entry.name };
      }
      if (entry.emittedStart) {
        sawToolCall = true;
        yield { type: 'tool_use_end', id: outId, input: parseToolArgs(entry.args) };
      } else if (process.env.MOXXY_DEBUG) {
        // A pending function call that never carried a name and never started:
        // we cannot synthesize a valid tool_use, so it is dropped — but make
        // it observable rather than silently swallowed.
        console.error(
          `[openai-codex] dropping a truncated function_call with no name (id=${outId}, args=${entry.args.length}B)`,
        );
      }
    }

    // If we yielded any tool_use_end this stream, the turn IS a tool-use
    // turn regardless of what `response.completed` said. The Responses API
    // sends `completed` with no stop_reason field, so we infer from the
    // events we actually emitted. Without this upgrade, codex turns with
    // tool calls were reported as end_turn and the loop dropped them.
    if (stopReason === 'end_turn' && sawToolCall) {
      stopReason = 'tool_use';
    }

    yield {
      type: 'message_end',
      stopReason,
      ...(usageIn > 0 || usageOut > 0
        ? {
            usage: {
              inputTokens: usageIn,
              outputTokens: usageOut,
              ...(usageCacheRead > 0 ? { cacheReadTokens: usageCacheRead } : {}),
            },
          }
        : {}),
    };
  } finally {
    // Always release the HTTP body — on normal completion, error, abort, or
    // the consumer abandoning the stream early — so the socket isn't leaked.
    reader.cancel().catch(() => {});
  }
}
