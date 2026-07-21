import type { ProviderEvent, ProviderRequest } from '@moxxy/sdk';
import { CLAUDE_CODE_SYSTEM } from './constants.js';

interface ProtocolState {
  started: boolean;
  ended: boolean;
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'error';
  inputTokens?: number;
  outputTokens?: number;
}

export function serializeClaudePrompt(req: ProviderRequest): string {
  const system: string[] = [CLAUDE_CODE_SYSTEM];
  if (req.system) system.push(req.system);
  const conversation: string[] = [];

  for (const message of req.messages) {
    const text: string[] = [];
    for (const block of message.content) {
      if (block.type !== 'text') {
        throw new Error(`Claude CLI text transport does not support ${block.type} content`);
      }
      text.push(block.text);
    }
    if (message.role === 'system') system.push(text.join(''));
    else conversation.push(`<${message.role}>\n${text.join('')}\n</${message.role}>`);
  }

  return `<system>\n${system.join('\n\n')}\n</system>\n\n${conversation.join('\n\n')}`;
}

export function createProtocolState(): ProtocolState {
  return { started: false, ended: false, stopReason: 'end_turn' };
}

export function parseClaudeRecord(line: string, state: ProtocolState): ProviderEvent[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('Claude CLI emitted malformed stream-json');
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Claude CLI emitted malformed stream-json record');
  }

  if (value.type === 'system') return [];
  if (value.type === 'assistant') return parseAssistantRecord(value);
  if (value.type === 'stream_event') return parseStreamEvent(value.event, state);
  if (value.type === 'result') return parseResult(value, state);
  throw new Error(`Claude CLI emitted unsupported stream-json record: ${value.type}`);
}

function parseAssistantRecord(record: Record<string, unknown>): ProviderEvent[] {
  if (!isRecord(record.message) || !Array.isArray(record.message.content)) {
    throw new Error('Claude CLI emitted malformed assistant record');
  }
  for (const block of record.message.content) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') {
      throw new Error('Claude CLI emitted unsupported assistant content');
    }
  }
  // Partial text arrives through stream_event records; validating this envelope
  // prevents a new native-tool block from being silently ignored.
  return [];
}

function parseStreamEvent(raw: unknown, state: ProtocolState): ProviderEvent[] {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    throw new Error('Claude CLI emitted malformed stream event');
  }
  switch (raw.type) {
    case 'message_start':
      state.started = true;
      return [];
    case 'content_block_start': {
      if (!isRecord(raw.content_block) || raw.content_block.type !== 'text') {
        throw new Error('Claude CLI emitted unsupported non-text content block');
      }
      return [];
    }
    case 'content_block_delta': {
      if (!isRecord(raw.delta) || raw.delta.type !== 'text_delta' || typeof raw.delta.text !== 'string') {
        throw new Error('Claude CLI emitted unsupported content delta');
      }
      return [{ type: 'text_delta', delta: raw.delta.text }];
    }
    case 'content_block_stop':
    case 'message_stop':
      return [];
    case 'message_delta': {
      if (!isRecord(raw.delta)) throw new Error('Claude CLI emitted malformed message delta');
      if (raw.delta.stop_reason != null) state.stopReason = mapStopReason(raw.delta.stop_reason);
      if (isRecord(raw.usage) && typeof raw.usage.output_tokens === 'number') {
        state.outputTokens = raw.usage.output_tokens;
      }
      return [];
    }
    case 'ping':
      return [];
    default:
      throw new Error(`Claude CLI emitted unsupported stream event: ${raw.type}`);
  }
}

function parseResult(record: Record<string, unknown>, state: ProtocolState): ProviderEvent[] {
  if (state.ended) throw new Error('Claude CLI emitted more than one terminal result');
  state.ended = true;
  if (record.is_error === true || record.subtype !== 'success') {
    const message = typeof record.result === 'string' ? record.result : 'Claude CLI request failed';
    return [{ type: 'error', message, retryable: false }];
  }

  if (isRecord(record.usage)) {
    const input = record.usage.input_tokens;
    const output = record.usage.output_tokens;
    if (typeof input === 'number') state.inputTokens = input;
    if (typeof output === 'number') state.outputTokens = output;
  }
  const usage = state.inputTokens !== undefined && state.outputTokens !== undefined
    ? { inputTokens: state.inputTokens, outputTokens: state.outputTokens }
    : undefined;
  return [{ type: 'message_end', stopReason: state.stopReason, ...(usage ? { usage } : {}) }];
}

function mapStopReason(value: unknown): ProtocolState['stopReason'] {
  switch (value) {
    case 'end_turn': return 'end_turn';
    case 'max_tokens': return 'max_tokens';
    case 'stop_sequence': return 'stop_sequence';
    default: throw new Error(`Claude CLI emitted unsupported stop reason: ${String(value)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
