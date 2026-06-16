import { textOf } from './utils/record';
import type { PromptAttachment } from './clientFrames';

export type TranscriptItem =
  | UserTranscriptItem
  | AssistantTranscriptItem
  | ToolGroupTranscriptItem
  | ErrorTranscriptItem
  | SystemGroupTranscriptItem;

export interface UserTranscriptItem {
  readonly id: string;
  readonly kind: 'user';
  readonly text: string;
  readonly attachments?: ReadonlyArray<PromptAttachment>;
}

export interface AssistantTranscriptItem {
  readonly id: string;
  readonly kind: 'assistant';
  readonly label: 'Assistant';
  readonly text: string;
  readonly streaming: boolean;
  readonly stopReason?: string;
}

export interface ToolGroupTranscriptItem {
  readonly id: string;
  readonly kind: 'tool-group';
  readonly title: 'Tools';
  readonly collapsed: true;
  readonly summary: string;
  readonly tools: ReadonlyArray<ToolTranscriptItem>;
}

export interface ToolTranscriptItem {
  readonly id: string;
  readonly name: string;
  readonly status: 'running' | 'ok' | 'error';
  readonly summary: string;
}

export interface ErrorTranscriptItem {
  readonly id: string;
  readonly kind: 'error';
  readonly label: string;
  readonly text: string;
}

export interface SystemGroupTranscriptItem {
  readonly id: string;
  readonly kind: 'system-group';
  readonly title: 'Runtime';
  readonly collapsed: true;
  readonly count: number;
  readonly events: ReadonlyArray<SystemEventSummary>;
}

export interface SystemEventSummary {
  readonly id: string;
  readonly type: string;
  readonly text: string;
}

const HIDDEN_EVENT_TYPES = new Set([
  'provider_request',
  'provider_response',
  'mode_iteration',
  'plugin_registered',
  'session_ready',
]);

const TOOL_EVENT_TYPES = new Set([
  'tool_call_requested',
  'tool_call_started',
  'tool_result',
  'tool_call_completed',
  'tool_call_approved',
  'tool_call_denied',
  'command',
]);

export function buildChatTranscript(
  events: ReadonlyArray<Record<string, unknown>>,
  streamingText = '',
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const itemIdCounts = new Map<string, number>();
  let assistantStreamId: string | null = null;
  let assistantStreamText = '';
  let tools: ToolTranscriptItem[] = [];
  let systemEvents: SystemEventSummary[] = [];

  const pushItem = (item: TranscriptItem): void => {
    const count = itemIdCounts.get(item.id) ?? 0;
    itemIdCounts.set(item.id, count + 1);
    items.push(count === 0 ? item : { ...item, id: `${item.id}:${count + 1}` });
  };

  const flushAssistant = (): void => {
    if (!assistantStreamId || assistantStreamText.trim().length === 0) return;
    pushItem({
      id: `assistant-stream:${assistantStreamId}`,
      kind: 'assistant',
      label: 'Assistant',
      text: assistantStreamText,
      streaming: true,
    });
    assistantStreamId = null;
    assistantStreamText = '';
  };

  const flushTools = (): void => {
    if (tools.length === 0) return;
    pushItem({
      id: `tools:${tools[0]!.id}`,
      kind: 'tool-group',
      title: 'Tools',
      collapsed: true,
      summary: summarizeToolStatuses(tools),
      tools,
    });
    tools = [];
  };

  const flushSystem = (): void => {
    if (systemEvents.length === 0) return;
    pushItem({
      id: `system:${systemEvents[0]!.id}`,
      kind: 'system-group',
      title: 'Runtime',
      collapsed: true,
      count: systemEvents.length,
      events: systemEvents,
    });
    systemEvents = [];
  };

  const uniqueEvents = dedupeEventsById(events);
  for (let index = 0; index < uniqueEvents.length; index += 1) {
    const event = uniqueEvents[index]!;
    const type = eventType(event);

    if (type === 'assistant_chunk') {
      const delta = firstText(event.delta, event.text, event.content);
      if (delta.length === 0) continue;
      assistantStreamId = assistantStreamId ?? eventId(event, `chunk-${index}`);
      assistantStreamText += delta;
      continue;
    }

    if (HIDDEN_EVENT_TYPES.has(type)) continue;

    if (type === 'assistant' || type === 'assistant_message') {
      flushTools();
      flushSystem();
      assistantStreamId = null;
      assistantStreamText = '';
      pushItem({
        id: eventId(event, `assistant-${index}`),
        kind: 'assistant',
        label: 'Assistant',
        text: firstText(event.content, event.text, event.message, event.body) || 'Assistant response',
        streaming: false,
        ...(textOf(event.stopReason).length > 0 ? { stopReason: textOf(event.stopReason) } : {}),
      });
      continue;
    }

    if (type === 'user' || type === 'user_prompt') {
      flushAssistant();
      flushTools();
      flushSystem();
      pushItem({
        id: eventId(event, `user-${index}`),
        kind: 'user',
        text: firstText(event.text, event.content, event.message, event.body) || 'User message',
        ...(promptAttachments(event).length > 0 ? { attachments: promptAttachments(event) } : {}),
      });
      continue;
    }

    if (TOOL_EVENT_TYPES.has(type)) {
      flushAssistant();
      flushSystem();
      tools = upsertTool(tools, event, type, index);
      continue;
    }

    if (type === 'error' || type === 'abort' || type === 'turn_error') {
      flushAssistant();
      flushTools();
      flushSystem();
      pushItem({
        id: eventId(event, `error-${index}`),
        kind: 'error',
        label: type,
        text: firstText(event.message, event.error, event.text, event.body) || 'The turn was interrupted.',
      });
      continue;
    }

    const text = firstText(event.message, event.text, event.content, event.summary, event.title);
    if (text.length > 0) {
      flushAssistant();
      systemEvents.push({
        id: eventId(event, `system-${index}`),
        type,
        text,
      });
    }
  }

  flushAssistant();
  flushTools();
  flushSystem();

  if (streamingText.trim().length > 0) {
    pushItem({
      id: 'assistant-stream:external',
      kind: 'assistant',
      label: 'Assistant',
      text: streamingText,
      streaming: true,
    });
  }

  return items;
}

function dedupeEventsById(
  events: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<Record<string, unknown>> {
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];
  for (const event of events) {
    const id = textOf(event.id);
    if (id.length > 0) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    unique.push(event);
  }
  return unique;
}

function promptAttachments(event: Record<string, unknown>): PromptAttachment[] {
  if (!Array.isArray(event.attachments)) return [];
  return event.attachments.filter(isPromptAttachment);
}

function isPromptAttachment(value: unknown): value is PromptAttachment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PromptAttachment>;
  return typeof item.kind === 'string' && typeof item.content === 'string';
}

function upsertTool(
  tools: ReadonlyArray<ToolTranscriptItem>,
  event: Record<string, unknown>,
  type: string,
  index: number,
): ToolTranscriptItem[] {
  const id = toolCallId(event) || `tool-${index}`;
  const existing = tools.find((tool) => tool.id === id);
  const status = toolStatus(type, event);
  const next: ToolTranscriptItem = {
    id,
    name: firstText(event.name, event.toolName, event.command, event.title) || existing?.name || 'Tool',
    status,
    summary: summarizeToolInput(event.input) || existing?.summary || firstText(event.command, event.path, event.title),
  };
  if (!existing) return [...tools, next];
  return tools.map((tool) =>
    tool.id === id
      ? {
          ...tool,
          name: next.name || tool.name,
          status,
          summary: next.summary || tool.summary,
        }
      : tool,
  );
}

function toolStatus(type: string, event: Record<string, unknown>): ToolTranscriptItem['status'] {
  if (type === 'tool_call_denied') return 'error';
  if (type === 'tool_result' || type === 'tool_call_completed') {
    if (event.ok === false || event.isError === true || hasErrorPayload(event.error)) return 'error';
    return 'ok';
  }
  return 'running';
}

function summarizeToolStatuses(tools: ReadonlyArray<ToolTranscriptItem>): string {
  const counts = tools.reduce(
    (acc, tool) => {
      acc[tool.status] += 1;
      return acc;
    },
    { ok: 0, error: 0, running: 0 },
  );
  return [
    counts.ok > 0 ? `${counts.ok} ok` : '',
    counts.error > 0 ? `${counts.error} failed` : '',
    counts.running > 0 ? `${counts.running} running` : '',
  ].filter(Boolean).join(' · ');
}

function summarizeToolInput(value: unknown): string {
  if (typeof value === 'string') return oneLine(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 2)
    .map(([key, val]) => `${key}: ${primitiveSummary(val)}`)
    .join(' · ');
}

function primitiveSummary(value: unknown): string {
  if (typeof value === 'string') return oneLine(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === 'object') return 'object';
  return '';
}

function eventType(event: Record<string, unknown>): string {
  return textOf(event.type, textOf(event.role, 'event'));
}

function eventId(event: Record<string, unknown>, fallback: string): string {
  return firstText(event.id, event.requestId, event.callId) || fallback;
}

function toolCallId(event: Record<string, unknown>): string {
  return firstText(
    event.callId,
    event.toolCallId,
    event.toolUseId,
    event.tool_call_id,
    event.tool_use_id,
    event.id,
  );
}

function hasErrorPayload(value: unknown): boolean {
  if (textOf(value).length > 0) return true;
  if (!value || typeof value !== 'object') return false;
  const error = value as Record<string, unknown>;
  return textOf(error.message, textOf(error.reason, textOf(error.kind))).length > 0;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textOf(value);
    if (text.trim().length > 0) return text;
  }
  return '';
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
