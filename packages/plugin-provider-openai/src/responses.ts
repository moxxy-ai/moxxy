import type OpenAI from 'openai';
import type { ProviderEvent, ProviderRequest, TokenUsage } from '@moxxy/sdk';
import { toResponsesInput, toResponsesTools } from './responses-input.js';
import { toFriendlyError } from '@moxxy/sdk';

/** Stateless requests: Moxxy's event log owns the conversation. */
export async function* streamResponses(
  client: OpenAI,
  req: ProviderRequest,
  model: string,
  provider: string,
): AsyncIterable<ProviderEvent> {
  const input = toResponsesInput(req.messages, provider);
  if (req.system) input.unshift({ role: 'system', content: req.system });
  const reasoning = req.reasoning && typeof req.reasoning === 'object' ? req.reasoning : undefined;
  try {
    const stream = await client.responses.create({
      model, input, stream: true, store: false,
      include: ['reasoning.encrypted_content'],
      ...(req.tools?.length ? { tools: toResponsesTools(req.tools) } : {}),
      ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.fast ? { service_tier: 'priority' } : {}),
      ...(req.reasoning ? { reasoning: { effort: reasoning?.effort, summary: 'auto' } } : {}),
    }, req.signal ? { signal: req.signal } : undefined);
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let finished = false;
    for await (const event of stream) {
      if (req.signal?.aborted) throw new Error('aborted');
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'response.failed') throw new Error(event.response.error?.message ?? 'OpenAI response failed');
      if (event.type === 'response.incomplete') {
        finished = true;
        const usage = toProviderUsage(event.response.usage);
        yield { type: 'message_end', stopReason: event.response.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : 'error', ...(usage ? { usage } : {}) };
        return;
      }
      if (event.type === 'response.output_item.added' && event.item.type === 'function_call') {
        calls.set(event.output_index, { id: event.item.call_id, name: event.item.name, arguments: event.item.arguments });
        yield { type: 'tool_use_start', id: event.item.call_id, name: event.item.name };
      }
      if (event.type === 'response.function_call_arguments.delta') {
        const call = calls.get(event.output_index);
        if (!call) throw new Error('Function arguments arrived without a function call');
        call.arguments += event.delta;
        yield { type: 'tool_use_delta', id: call.id, partialInput: event.delta };
      }
      if (event.type === 'response.output_item.done' && event.item.type === 'function_call') {
        if (!calls.has(event.output_index)) yield { type: 'tool_use_start', id: event.item.call_id, name: event.item.name };
        calls.set(event.output_index, { id: event.item.call_id, name: event.item.name, arguments: event.item.arguments });
      }
      if (event.type === 'response.reasoning_summary_text.delta' && req.reasoning) yield { type: 'reasoning_delta', delta: event.delta };
      if (event.type === 'response.output_item.done' && event.item.type === 'reasoning') {
        yield { type: 'reasoning_signature', replayItem: { provider, item: { ...event.item } } };
      }
      if (event.type === 'response.refusal.delta') yield { type: 'text_delta', delta: event.delta };
      if (event.type === 'response.output_text.delta') yield { type: 'text_delta', delta: event.delta };
      if (event.type === 'response.completed') {
        // Validate the entire batch before releasing any tool for execution.
        const parsed = [...calls.values()].map(call => ({ ...call, input: JSON.parse(call.arguments || '{}') as unknown }));
        for (const call of parsed) yield { type: 'tool_use_end', id: call.id, input: call.input };
        finished = true;
        const usage = toProviderUsage(event.response.usage);
        yield { type: 'message_end', stopReason: calls.size ? 'tool_use' : 'end_turn', ...(usage ? { usage } : {}) };
      }
    }
    if (!finished) throw new Error('OpenAI stream ended before a terminal response');
  } catch (error) {
    yield { type: 'error', ...(req.signal?.aborted ? { message: 'aborted', retryable: false } : toFriendlyError(error, { provider })) };
  }
}

function toProviderUsage(usage: OpenAI.Responses.ResponseUsage | null | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, usage.input_tokens - cached),
    outputTokens: usage.output_tokens,
    cacheReadTokens: cached,
  };
}
