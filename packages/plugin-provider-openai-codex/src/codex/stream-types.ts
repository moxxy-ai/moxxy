import type { ProviderEvent, StopReason } from '@moxxy/sdk';

export interface PendingFunctionCall {
  id: string;
  callId: string;
  name: string;
  args: string;
  emittedStart: boolean;
}

export interface ResponsesSseEvent {
  type?: string;
  delta?: string;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    /** On a `reasoning` output item: the opaque blob to replay (round-trip). */
    encrypted_content?: string;
  };
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  response?: {
    status?: string;
    incomplete_details?: { reason?: string };
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  };
  error?: { message?: string };
}

export interface SseStepResult {
  events?: ProviderEvent[];
  stopReason?: StopReason;
  usage?: { input?: number; output?: number; cacheRead?: number };
  terminal?: boolean;
}

/**
 * Parse accumulated function-call argument text into the tool input. The
 * server normally sends well-formed JSON, but a truncated stream can leave
 * partial JSON; rather than drop the call we surface the raw text under
 * `_rawPartial` so the upstream loop still sees the tool request. Shared by
 * the per-event handler (`function_call_arguments.done`) and the consumer's
 * truncated-stream flush so the two stay in lockstep.
 */
export function parseToolArgs(args: string): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { _rawPartial: args };
  }
}
