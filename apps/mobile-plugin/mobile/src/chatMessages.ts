import { textOf } from './utils/record';

export type ChatMessageKind = 'user' | 'assistant' | 'tool' | 'error' | 'system';

export interface ChatMessage {
  readonly kind: ChatMessageKind;
  readonly label: string | null;
  readonly text: string;
}

const TOOL_EVENT_TYPES = new Set([
  'tool_call_requested',
  'tool_call_started',
  'tool_result',
  'tool_call_completed',
  'command',
]);

export function buildChatMessage(event: Record<string, unknown>): ChatMessage {
  const rawKind = textOf(event.role, textOf(event.type, 'event'));
  const text = firstText(event.text, event.content, event.message, event.body, event.summary);

  if (rawKind === 'user' || rawKind === 'user_prompt') {
    return { kind: 'user', label: null, text: text || 'User message' };
  }

  if (rawKind === 'assistant' || rawKind === 'assistant_message') {
    return { kind: 'assistant', label: 'Assistant', text: text || 'Assistant response' };
  }

  if (TOOL_EVENT_TYPES.has(rawKind)) {
    return {
      kind: 'tool',
      label: toolLabel(rawKind),
      text: firstText(event.name, event.toolName, event.command, event.title) || 'Runtime action',
    };
  }

  if (rawKind === 'error' || rawKind === 'abort' || rawKind === 'turn_error') {
    return { kind: 'error', label: rawKind, text: text || 'The turn was interrupted.' };
  }

  return { kind: 'system', label: rawKind, text: text || 'Event received' };
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textOf(value);
    if (text.trim().length > 0) return text;
  }
  return '';
}

function toolLabel(type: string): string {
  if (type === 'tool_result' || type === 'tool_call_completed') return 'Tool result';
  if (type === 'command') return 'Command';
  return 'Tool call';
}
