import type { ProviderEvent, StopReason } from '@moxxy/sdk';
import {
  parseToolArgs,
  type PendingFunctionCall,
  type ResponsesSseEvent,
  type SseStepResult,
} from './stream-types.js';

/**
 * Hard cap on a single tool call's accumulated argument text. `entry.args` grows
 * by every `function_call_arguments.delta`; unlike the consumer's per-frame
 * reassembly buffer (which shrinks once a frame is parsed), this accumulates
 * ACROSS frames and is otherwise unbounded — a hostile stream of millions of
 * small, individually-valid delta frames would grow it to OOM without ever
 * tripping the frame-buffer cap. 16 MiB is far beyond any legitimate tool-call
 * payload. Exceeding it is treated as a hostile stream (terminal error).
 */
const MAX_TOOL_ARGS_CHARS = 16 * 1024 * 1024;

/**
 * Hard cap on the number of concurrently-pending function calls. Each distinct
 * `output_item.added` function_call seeds a `pending` entry that lives until its
 * `.done` (or the post-stream flush); a hostile stream could emit unbounded
 * distinct ids and never finish them, growing the Map without limit. No real
 * turn fans out to anywhere near this many parallel tool calls.
 */
const MAX_PENDING_TOOL_CALLS = 1024;

const TOOL_STREAM_LIMIT_ERROR = (what: string): SseStepResult => ({
  events: [{ type: 'error', message: `Codex tool-call stream exceeded ${what} limit`, retryable: false }],
  terminal: true,
});

/**
 * Map a single Responses-API SSE event to zero or more moxxy ProviderEvents.
 * Centralized here so the streaming loop stays a thin "read frame → call
 * this → yield" structure and the event taxonomy is easy to test directly.
 *
 * Events we care about (subset of the full Responses API surface):
 *   response.output_text.delta         → text_delta
 *   response.output_item.added         → tool_use_start (if it's a function_call)
 *   response.function_call_arguments.delta → tool_use_delta
 *   response.function_call_arguments.done  → finalize tool_use_end
 *   response.completed                 → message_end (sets stopReason)
 *   response.failed / response.error   → error
 */
export function handleSseEvent(
  ev: ResponsesSseEvent,
  pending: Map<string, PendingFunctionCall>,
  emitReasoning = false,
): SseStepResult {
  const type = ev.type ?? '';

  if (type === 'response.output_text.delta' && typeof ev.delta === 'string' && ev.delta) {
    return { events: [{ type: 'text_delta', delta: ev.delta }] };
  }

  // Reasoning summary text (Codex requests `summary: 'auto'`) → reasoning_delta.
  // The streamed summary is the visible "thinking" between tool calls. Gated on
  // the per-provider reasoning toggle; off → discard as before.
  if (emitReasoning && type === 'response.reasoning_summary_text.delta' && typeof ev.delta === 'string' && ev.delta) {
    return { events: [{ type: 'reasoning_delta', delta: ev.delta }] };
  }

  // A `reasoning` output item carries the encrypted_content we must replay
  // verbatim on the next request (Codex requests `include: ['reasoning.encrypted_content']`).
  if (emitReasoning && type === 'response.output_item.added' && ev.item?.type === 'reasoning') {
    return ev.item.encrypted_content
      ? { events: [{ type: 'reasoning_signature', encrypted: ev.item.encrypted_content }] }
      : {};
  }

  if (type === 'response.output_item.added' && ev.item?.type === 'function_call') {
    const id = ev.item.id ?? ev.item.call_id ?? `call_${pending.size}`;
    // Bound the number of in-flight tool calls: a hostile stream could otherwise
    // seed unbounded distinct ids and never `.done` them, growing the Map to OOM.
    // (A new id that would overflow is rejected; re-using an existing id is fine.)
    if (!pending.has(id) && pending.size >= MAX_PENDING_TOOL_CALLS) {
      return TOOL_STREAM_LIMIT_ERROR('pending-call count');
    }
    const callId = ev.item.call_id ?? id;
    const name = ev.item.name ?? '';
    const entry: PendingFunctionCall = {
      id,
      callId,
      name,
      args: ev.item.arguments ?? '',
      emittedStart: false,
    };
    pending.set(id, entry);
    if (name) {
      entry.emittedStart = true;
      return { events: [{ type: 'tool_use_start', id: callId, name }] };
    }
    return {};
  }

  if (type === 'response.function_call_arguments.delta') {
    const id = ev.item_id ?? ev.call_id ?? '';
    const entry = pending.get(id);
    const delta = ev.delta ?? '';
    if (entry && typeof delta === 'string') {
      // Bound the per-call argument accumulation: this grows across frames and
      // is not covered by the consumer's per-frame reassembly cap.
      if (entry.args.length + delta.length > MAX_TOOL_ARGS_CHARS) {
        return TOOL_STREAM_LIMIT_ERROR('argument size');
      }
      entry.args += delta;
      const outId = entry.callId || entry.id;
      // If we hadn't emitted tool_use_start yet (server sent the args
      // before the item.added with a name), do so now using whatever
      // name landed later. Defensive — opencode's pattern.
      const startEvents: ProviderEvent[] = [];
      if (!entry.emittedStart && entry.name) {
        entry.emittedStart = true;
        startEvents.push({ type: 'tool_use_start', id: outId, name: entry.name });
      }
      return {
        events: [...startEvents, { type: 'tool_use_delta', id: outId, partialInput: delta }],
      };
    }
    return {};
  }

  if (type === 'response.function_call_arguments.done') {
    const id = ev.item_id ?? ev.call_id ?? '';
    const entry = pending.get(id);
    if (!entry) return {};
    pending.delete(id);
    if (typeof ev.arguments === 'string' && ev.arguments) entry.args = ev.arguments;
    const input = parseToolArgs(entry.args);
    const outId = entry.callId || entry.id;
    const events: ProviderEvent[] = [];
    if (!entry.emittedStart && entry.name) {
      events.push({ type: 'tool_use_start', id: outId, name: entry.name });
    }
    events.push({ type: 'tool_use_end', id: outId, input });
    return { events };
  }

  if (type === 'response.completed') {
    const usage = ev.response?.usage;
    const input = usage?.input_tokens ?? 0;
    const cacheRead = usage?.input_tokens_details?.cached_tokens ?? 0;
    const incomplete = ev.response?.incomplete_details?.reason;
    let stopReason: StopReason = 'end_turn';
    if (incomplete === 'max_output_tokens') stopReason = 'max_tokens';
    else if (incomplete === 'stop_sequence') stopReason = 'stop_sequence';
    // The presence of unflushed function calls would already get mapped to
    // tool_use by the post-loop logic; the explicit "completed" event
    // doesn't carry a tool_use stop reason on its own.
    return {
      stopReason,
      ...(usage
        ? {
            usage: {
              input: Math.max(0, input - cacheRead),
              output: usage.output_tokens ?? 0,
              ...(usage.input_tokens_details?.cached_tokens !== undefined ? { cacheRead } : {}),
            },
          }
        : {}),
      terminal: true,
    };
  }

  if (type === 'response.failed' || type === 'response.error' || type === 'error') {
    const msg = ev.error?.message ?? `Codex stream failed: ${type}`;
    return { events: [{ type: 'error', message: msg, retryable: false }], terminal: true };
  }

  return {};
}
