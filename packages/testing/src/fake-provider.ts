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

  constructor(opts: FakeProviderOptions = {}) {
    this.name = opts.name ?? 'fake';
    this.models = opts.models ?? [defaultModel];
    this.script = opts.script ?? [];
    this.byHash = opts.byHash ?? {};
    this.onRequest = opts.onRequest;
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.received.push(req);
    this.onRequest?.(req);
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
      yield event;
    }
  }

  async countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number> {
    const blob =
      (req.system ?? '') +
      req.messages.map((m) => m.content.map((c) => ('text' in c ? c.text : JSON.stringify(c))).join('')).join('') +
      (req.tools ?? []).map((t) => t.name + t.description).join('');
    return estimateTextTokens(blob);
  }

  reset(): void {
    this.cursor = 0;
    this.received.length = 0;
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
