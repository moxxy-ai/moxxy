/**
 * Event-log → transcript projection: coalesces the raw moxxy event stream into
 * the items the chat list renders (streamed assistant text folded into one
 * bubble, tool lifecycle events folded into one collapsed group, runtime noise
 * folded into a collapsed "Runtime" group).
 *
 * Event-name reconciliation against `MoxxyEvent` in `@moxxy/sdk` (events.ts):
 * every primary type string here exists verbatim in the SDK — `user_prompt`,
 * `assistant_chunk` (delta), `assistant_message` (content + stopReason),
 * `tool_call_requested` / `tool_call_approved` / `tool_call_denied`,
 * `tool_result` (ok / error{message,kind}), `error`, `abort`, and the hidden
 * bookkeeping types (`provider_request`, `provider_response`, `mode_iteration`,
 * `plugin_registered`). The extra strings the reference also accepted
 * (`assistant`, `user`, `tool_call_started`, `tool_call_completed`, `command`,
 * `turn_error`, `session_ready`) are NOT SDK events — they are kept as
 * defensive aliases for bridge-side frames so an unknown-but-shaped record
 * still renders sensibly. Inputs stay `Record<string, unknown>` because events
 * arrive over the wire untyped.
 */

import { textOf } from './utils/record';
import type { UserPromptAttachment as PromptAttachment } from '@moxxy/sdk';

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
  /** Pretty-printed tool input, capped — for the tap-to-expand diagnostics. */
  readonly input?: string;
  /** Pretty-printed tool output, capped (tool_result frames can be huge). */
  readonly output?: string;
  /** Error/denial message when the call failed. */
  readonly errorText?: string;
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
  let assistantStreamId: string | null = null;
  let assistantStreamText = '';
  let tools: ToolTranscriptItem[] = [];
  let systemEvents: SystemEventSummary[] = [];

  const flushAssistant = (): void => {
    if (!assistantStreamId || assistantStreamText.trim().length === 0) return;
    items.push({
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
    items.push({
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
    items.push({
      id: `system:${systemEvents[0]!.id}`,
      kind: 'system-group',
      title: 'Runtime',
      collapsed: true,
      count: systemEvents.length,
      events: systemEvents,
    });
    systemEvents = [];
  };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
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
      items.push({
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
      items.push({
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
      items.push({
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
    items.push({
      id: 'assistant-stream:external',
      kind: 'assistant',
      label: 'Assistant',
      text: streamingText,
      streaming: true,
    });
  }

  return items;
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
  const input = toolDetail(event.input) || existing?.input || '';
  const output =
    (type === 'tool_result' || type === 'tool_call_completed' ? toolDetail(event.output) : '') ||
    existing?.output ||
    '';
  const errorText = toolErrorText(type, event) || existing?.errorText || '';
  const next: ToolTranscriptItem = {
    id,
    name: firstText(event.name, event.toolName, event.command, event.title) || existing?.name || 'Tool',
    status,
    summary: summarizeToolInput(event.input) || existing?.summary || firstText(event.command, event.path, event.title),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(errorText ? { errorText } : {}),
  };
  if (!existing) return [...tools, next];
  return tools.map((tool) => (tool.id === id ? next : tool));
}

// tool_result frames can carry entire file reads — cap what the transcript
// retains so the chat list never holds megabytes per tool row.
const TOOL_DETAIL_MAX_CHARS = 16_384;

function toolDetail(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : safeJson(value);
  if (text.length <= TOOL_DETAIL_MAX_CHARS) return text;
  return `${text.slice(0, TOOL_DETAIL_MAX_CHARS)}\n… truncated (${text.length} chars)`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function toolErrorText(type: string, event: Record<string, unknown>): string {
  if (type === 'tool_call_denied') return firstText(event.reason, event.message) || 'Tool call denied';
  if (type !== 'tool_result' && type !== 'tool_call_completed') return '';
  const error = event.error;
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const payload = error as Record<string, unknown>;
  return firstText(payload.message, payload.reason, payload.kind);
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
