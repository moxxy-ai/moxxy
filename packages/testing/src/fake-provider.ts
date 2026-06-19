import type { LLMProvider, ModelDescriptor, ProviderEvent, ProviderRequest } from '@moxxy/sdk';
import { estimateTextTokens } from '@moxxy/sdk';
import { hashRequest } from './hash.js';

export type ScriptedReply = ReadonlyArray<ProviderEvent>;
export type ScriptedReplies = ReadonlyArray<ScriptedReply>;

export interface FakeProviderOptions {
  readonly name?: string;
  readonly models?: ReadonlyArray<ModelDescriptor>;
  readonly script?: ScriptedReplies;
  readonly byHash?: Record<string, ScriptedReply>;
  readonly onRequest?: (req: ProviderRequest) => void;
  /**
   * Cap on retained `received` requests. Each request can be the full
   * conversation history, so an unbounded buffer is O(turns * history) for a
   * long-lived instance (goal-mode / fuzz tests). When set, only the most
   * recent N requests are kept. Default: unbounded (callers `reset()` between
   * scenarios).
   */
  readonly maxReceived?: number;
}

const defaultModel: ModelDescriptor = {
  id: 'fake-model',
  contextWindow: 200_000,
  maxOutputTokens: 8000,
  supportsTools: true,
  supportsStreaming: true,
};

export class FakeProvider implements LLMProvider {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  readonly received: ProviderRequest[] = [];
  private cursor = 0;
  private readonly script: ScriptedReplies;
  private readonly byHash: Record<string, ScriptedReply>;
  private readonly onRequest?: (req: ProviderRequest) => void;
  private readonly maxReceived?: number;

  constructor(opts: FakeProviderOptions = {}) {
    this.name = opts.name ?? 'fake';
    this.models = opts.models ?? [defaultModel];
    this.script = opts.script ?? [];
    this.byHash = opts.byHash ?? {};
    this.onRequest = opts.onRequest;
    this.maxReceived = opts.maxReceived;
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.received.push(req);
    if (this.maxReceived !== undefined && this.received.length > this.maxReceived) {
      this.received.splice(0, this.received.length - this.maxReceived);
    }
    this.onRequest?.(req);
    // Mirror the real provider abort contract (anthropic provider.ts:368-369):
    // an already-aborted request yields a clean terminal error and stops, so
    // loop-level cancellation paths get exercised against the fake too.
    if (req.signal?.aborted) {
      yield { type: 'error', message: 'aborted', retryable: false };
      return;
    }
    const hash = hashRequest(req);
    // byHash mode is exact-match-or-bust: a non-empty map that lacks this
    // request's hash is a test-author error, not a cue to fall through to the
    // script (which would silently consume a cursor slot meant for a different
    // request and mask the mismatch). Throw without touching the cursor.
    const known = Object.keys(this.byHash);
    let reply: ScriptedReply | undefined;
    if (known.length > 0) {
      reply = this.byHash[hash];
      if (!reply) {
        throw new Error(
          `FakeProvider: no byHash reply for request (hash=${hash}). ` +
            `Known hashes: ${known.join(', ')}.`,
        );
      }
    } else {
      reply = this.script[this.cursor++];
      if (!reply) {
        throw new Error(
          `FakeProvider: no scripted reply for request (cursor=${this.cursor - 1}, hash=${hash}). ` +
            `Pass script[] or byHash{} when constructing.`,
        );
      }
    }
    for (const event of reply) {
      // Honor mid-stream cancellation between scripted events.
      if (req.signal?.aborted) {
        yield { type: 'error', message: 'aborted', retryable: false };
        return;
      }
      yield event;
    }
  }

  async countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number> {
    const blob =
      (req.system ?? '') +
      req.messages
        .map((m) => m.content.map((c) => ('text' in c ? c.text : safeStringify(c))).join(''))
        .join('') +
      (req.tools ?? []).map((t) => t.name + t.description).join('');
    return estimateTextTokens(blob);
  }

  reset(): void {
    this.cursor = 0;
    this.received.length = 0;
  }
}

/**
 * Best-effort stringify for token estimation: a content block carrying a
 * circular reference or a BigInt would otherwise throw from JSON.stringify and
 * abort the test under a serializer error instead of returning a count. A test
 * double should tolerate odd inputs — fall back to an empty string.
 */
function safeStringify(c: unknown): string {
  try {
    return JSON.stringify(c) ?? '';
  } catch {
    return '';
  }
}

export function textReply(text: string): ScriptedReply {
  return [
    { type: 'message_start', model: 'fake' },
    { type: 'text_delta', delta: text },
    { type: 'message_end', stopReason: 'end_turn' },
  ];
}

export function toolUseReply(toolName: string, input: unknown, callId = 'call_test'): ScriptedReply {
  return [
    { type: 'message_start', model: 'fake' },
    { type: 'tool_use_start', id: callId, name: toolName },
    { type: 'tool_use_end', id: callId, input },
    { type: 'message_end', stopReason: 'tool_use' },
  ];
}

export function streamingTextReply(chunks: ReadonlyArray<string>): ScriptedReply {
  return [
    { type: 'message_start', model: 'fake' },
    ...chunks.map<ProviderEvent>((c) => ({ type: 'text_delta', delta: c })),
    { type: 'message_end', stopReason: 'end_turn' },
  ];
}
