import { textOf } from './utils/record';
import type { PromptAttachment } from './clientFrames';

export type TranscriptItem =
  | UserTranscriptItem
  | AssistantTranscriptItem
  | ToolGroupTranscriptItem
  | ErrorTranscriptItem
  | SubagentGroupTranscriptItem
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
  readonly resultSummary?: string;
  readonly error?: string;
}

export interface SubagentGroupTranscriptItem {
  readonly id: string;
  readonly kind: 'subagent-group';
  readonly title: 'Subagents';
  readonly collapsed: true;
  status: 'running' | 'done' | 'failed';
  summary: string;
  readonly agents: SubagentTranscriptItem[];
}

export interface SubagentTranscriptItem {
  readonly id: string;
  readonly label: string;
  readonly agentType: string;
  status: 'running' | 'done' | 'failed';
  toolCallCount: number;
  tokensUsed: number | null;
  responseText: string;
  finalPreview: string | null;
  stopReason: string | null;
  error: string | null;
  readonly toolCalls: SubagentToolTranscriptItem[];
}

export interface SubagentToolTranscriptItem {
  readonly id: string;
  name: string;
  status: 'running' | 'ok' | 'error';
  summary: string;
  resultSummary: string | null;
  error: string | null;
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

const SUBAGENT_PLUGIN_ID = '@moxxy/subagents';

export function buildChatTranscript(
  events: ReadonlyArray<Record<string, unknown>>,
  streamingText = '',
): TranscriptItem[] {
  return appendStreamingTranscript(buildCommittedChatTranscript(events), streamingText);
}

export function buildCommittedChatTranscript(
  events: ReadonlyArray<Record<string, unknown>>,
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const itemIdCounts = new Map<string, number>();
  let assistantStreamId: string | null = null;
  let assistantStreamText = '';
  let tools: ToolTranscriptItem[] = [];
  let systemEvents: SystemEventSummary[] = [];
  const subagents = new Map<string, SubagentTranscriptItem>();
  const subagentGroupsByChildId = new Map<string, SubagentGroupTranscriptItem>();
  let currentSubagentGroup: SubagentGroupTranscriptItem | null = null;

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

  const closeSubagentRun = (): void => {
    currentSubagentGroup = null;
  };

  const handleSubagentEvent = (event: Record<string, unknown>): void => {
    const payload = isRecord(event.payload) ? event.payload : event;
    const subtype = firstText(event.subtype, payload.type, payload.eventType);
    const childSessionId = firstText(payload.childSessionId, payload.sessionId, payload.id);
    if (childSessionId.length === 0) return;

    if (subtype === 'subagent_started') {
      const agentType = firstText(payload.agentType, payload.type) || 'default';
      const label = firstText(payload.label, payload.name) || childSessionId;
      const agent: SubagentTranscriptItem = {
        id: childSessionId,
        label,
        agentType,
        status: 'running',
        toolCallCount: 0,
        tokensUsed: null,
        responseText: '',
        finalPreview: null,
        stopReason: null,
        error: null,
        toolCalls: [],
      };
      subagents.set(childSessionId, agent);
      if (!currentSubagentGroup) {
        currentSubagentGroup = {
          id: `subagents:${firstText(event.groupId, payload.groupId, eventId(event, `subagents-${items.length}`))}`,
          kind: 'subagent-group',
          title: 'Subagents',
          collapsed: true,
          status: 'running',
          summary: '',
          agents: [],
        };
        pushItem(currentSubagentGroup);
      }
      currentSubagentGroup.agents.push(agent);
      subagentGroupsByChildId.set(childSessionId, currentSubagentGroup);
      refreshSubagentGroup(currentSubagentGroup);
      return;
    }

    const agent = subagents.get(childSessionId);
    const group = subagentGroupsByChildId.get(childSessionId);
    if (!agent || !group) return;

    if (subtype === 'subagent_chunk') {
      agent.responseText += firstText(payload.delta, payload.text, payload.content);
      return;
    }

    if (subtype === 'subagent_tool_call') {
      agent.toolCallCount += 1;
      agent.toolCalls.push({
        id: subagentToolCallId(payload, `${childSessionId}:tool-${agent.toolCallCount}`),
        name: firstText(payload.name, payload.toolName, payload.command, payload.title) || 'Tool',
        status: 'running',
        summary: summarizeToolInput(payload.input),
        resultSummary: null,
        error: null,
      });
      refreshSubagentGroup(group);
      return;
    }

    if (subtype === 'subagent_tool_result') {
      const callId = subagentToolCallId(payload, `${childSessionId}:result-${agent.toolCalls.length + 1}`);
      const existing = agent.toolCalls.find((tool) => tool.id === callId);
      const error = summarizeToolError(payload.error);
      const next: SubagentToolTranscriptItem = {
        id: callId,
        name: existing?.name || firstText(payload.name, payload.toolName, payload.command, payload.title) || 'Tool',
        status: error || payload.ok === false ? 'error' : 'ok',
        summary: existing?.summary || summarizeToolInput(payload.input),
        resultSummary: error ? null : summarizeToolOutput(payload.output),
        error: error || null,
      };
      if (existing) {
        existing.name = next.name;
        existing.status = next.status;
        existing.summary = next.summary;
        existing.resultSummary = next.resultSummary;
        existing.error = next.error;
      } else {
        agent.toolCalls.push(next);
      }
      refreshSubagentGroup(group);
      return;
    }

    if (subtype === 'subagent_completed') {
      const error = firstText(payload.error, payload.message, payload.reason);
      const text = firstText(payload.finalPreview, payload.output, payload.text);
      agent.status = error ? 'failed' : 'done';
      agent.tokensUsed = numberOrNull(payload.tokensUsed);
      agent.responseText = text || agent.responseText;
      agent.finalPreview = oneLine(text || agent.responseText) || null;
      agent.stopReason = firstText(payload.stopReason) || null;
      agent.error = error || null;
      refreshSubagentGroup(group);
      if (group.status !== 'running') closeSubagentRun();
      return;
    }

    if (subtype === 'subagent_error' || subtype === 'subagent_abort' || subtype === 'subagent_aborted') {
      agent.status = 'failed';
      agent.error = firstText(payload.error, payload.message, payload.reason) || 'Subagent failed';
      refreshSubagentGroup(group);
      if (group.status !== 'running') closeSubagentRun();
    }
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

    if (isSubagentPluginEvent(event)) {
      flushAssistant();
      flushTools();
      flushSystem();
      handleSubagentEvent(event);
      continue;
    }

    if (HIDDEN_EVENT_TYPES.has(type)) continue;

    if (type === 'assistant' || type === 'assistant_message') {
      flushTools();
      flushSystem();
      closeSubagentRun();
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
      closeSubagentRun();
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
      closeSubagentRun();
      tools = upsertTool(tools, event, type, index);
      continue;
    }

    if (type === 'error' || type === 'abort' || type === 'turn_error') {
      flushAssistant();
      flushTools();
      flushSystem();
      closeSubagentRun();
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
      closeSubagentRun();
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

  return items;
}

export function appendStreamingTranscript(
  items: ReadonlyArray<TranscriptItem>,
  streamingText = '',
): TranscriptItem[] {
  if (streamingText.trim().length > 0) {
    return [
      ...items,
      {
        id: 'assistant-stream:external',
        kind: 'assistant',
        label: 'Assistant',
        text: streamingText,
        streaming: true,
      },
    ];
  }

  return items as TranscriptItem[];
}

function isSubagentPluginEvent(event: Record<string, unknown>): boolean {
  return eventType(event) === 'plugin_event' && firstText(event.pluginId, event.plugin, event.name) === SUBAGENT_PLUGIN_ID;
}

function refreshSubagentGroup(group: SubagentGroupTranscriptItem): void {
  const running = group.agents.filter((agent) => agent.status === 'running').length;
  const failed = group.agents.filter((agent) => agent.status === 'failed').length;
  group.status = running > 0 ? 'running' : failed > 0 ? 'failed' : 'done';
  group.summary = summarizeSubagentGroup(group, running, failed);
}

function summarizeSubagentGroup(group: SubagentGroupTranscriptItem, running: number, failed: number): string {
  const count = group.agents.length;
  const agentType = sharedAgentType(group.agents);
  if (running > 0) {
    return `${count} ${agentType} ${count === 1 ? 'agent' : 'agents'} running`;
  }
  if (failed > 0) {
    return `${failed} of ${count} ${count === 1 ? 'agent' : 'agents'} failed`;
  }
  return `${count} ${agentType} ${count === 1 ? 'agent' : 'agents'} finished`;
}

function sharedAgentType(agents: ReadonlyArray<SubagentTranscriptItem>): string {
  const first = agents[0]?.agentType || 'default';
  return agents.every((agent) => agent.agentType === first) ? first : 'mixed';
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
    ...toolResultDetails(event, status, existing),
  };
  if (!existing) return [...tools, next];
  return tools.map((tool) =>
    tool.id === id
      ? {
          ...tool,
          name: next.name || tool.name,
          status,
          summary: next.summary || tool.summary,
          ...(next.resultSummary ? { resultSummary: next.resultSummary } : {}),
          ...(next.error ? { error: next.error } : {}),
        }
      : tool,
  );
}

function toolResultDetails(
  event: Record<string, unknown>,
  status: ToolTranscriptItem['status'],
  existing?: ToolTranscriptItem,
): Pick<ToolTranscriptItem, 'resultSummary' | 'error'> {
  if (status === 'ok') {
    const resultSummary = summarizeToolOutput(firstDefined(
      event.output,
      event.result,
      event.content,
      event.message,
      event.body,
    )) || existing?.resultSummary;
    return resultSummary ? { resultSummary } : {};
  }
  if (status === 'error') {
    const error = summarizeToolError(event.error)
      || summarizeToolOutput(firstDefined(event.output, event.result, event.content, event.message, event.body))
      || existing?.error;
    return error ? { error } : {};
  }
  return {};
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

function summarizeToolOutput(value: unknown): string {
  if (typeof value === 'string') return limitSummary(oneLine(value));
  if (!value || typeof value !== 'object') return primitiveSummary(value);
  const maybeText = firstText(
    (value as Record<string, unknown>).text,
    (value as Record<string, unknown>).content,
    (value as Record<string, unknown>).message,
    (value as Record<string, unknown>).forModel,
  );
  return limitSummary(maybeText || summarizeToolInput(value));
}

function summarizeToolError(value: unknown): string {
  if (typeof value === 'string') return limitSummary(oneLine(value));
  if (!value || typeof value !== 'object') return '';
  return limitSummary(firstText(
    (value as Record<string, unknown>).message,
    (value as Record<string, unknown>).reason,
    (value as Record<string, unknown>).kind,
  ));
}

function limitSummary(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
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

function subagentToolCallId(payload: Record<string, unknown>, fallback: string): string {
  return firstText(
    payload.callId,
    payload.toolCallId,
    payload.toolUseId,
    payload.tool_call_id,
    payload.tool_use_id,
  ) || fallback;
}

function hasErrorPayload(value: unknown): boolean {
  if (textOf(value).length > 0) return true;
  if (!value || typeof value !== 'object') return false;
  const error = value as Record<string, unknown>;
  return textOf(error.message, textOf(error.reason, textOf(error.kind))).length > 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textOf(value);
    if (text.trim().length > 0) return text;
  }
  return '';
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
