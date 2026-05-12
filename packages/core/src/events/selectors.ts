import type {
  ContentBlock,
  EventLogReader,
  MoxxyEvent,
  PendingToolCall,
  ProviderMessage,
  ToolCallId,
  TurnId,
} from '@moxxy/sdk';

export type { PendingToolCall };

export interface SelectMessagesOptions {
  readonly includeSystem?: string;
  readonly maxEvents?: number;
}

export function selectPendingToolCalls(log: EventLogReader): ReadonlyArray<PendingToolCall> {
  const pending = new Map<ToolCallId, PendingToolCall>();
  for (const e of log.slice()) {
    if (e.type === 'tool_call_requested') {
      pending.set(e.callId, {
        callId: e.callId,
        name: e.name,
        input: e.input,
        requestedAtSeq: e.seq,
      });
    } else if (e.type === 'tool_result' || e.type === 'tool_call_denied') {
      pending.delete(e.callId);
    }
  }
  return [...pending.values()];
}

export function selectCurrentTurn(log: EventLogReader): TurnId | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log.at(i);
    if (e) return e.turnId;
  }
  return null;
}

interface CompactionRange {
  readonly from: number;
  readonly to: number;
  readonly summary: string;
}

function selectActiveCompactions(log: EventLogReader): ReadonlyArray<CompactionRange> {
  return log.ofType('compaction').map((e) => ({
    from: e.replacedRange[0],
    to: e.replacedRange[1],
    summary: e.summary,
  }));
}

function eventInRange(seq: number, ranges: ReadonlyArray<CompactionRange>): CompactionRange | null {
  for (const r of ranges) if (seq >= r.from && seq <= r.to) return r;
  return null;
}

export function selectMessages(
  log: EventLogReader,
  opts: SelectMessagesOptions = {},
): ReadonlyArray<ProviderMessage> {
  const messages: ProviderMessage[] = [];
  if (opts.includeSystem) {
    messages.push({ role: 'system', content: [{ type: 'text', text: opts.includeSystem }] });
  }

  const compactions = selectActiveCompactions(log);
  const seenCompactions = new Set<CompactionRange>();
  const events = log.slice();

  let currentAssistant: ContentBlock[] | null = null;
  let currentToolUseIds: string[] = [];

  const flushAssistant = (): void => {
    if (currentAssistant && currentAssistant.length > 0) {
      messages.push({ role: 'assistant', content: currentAssistant });
    }
    currentAssistant = null;
    currentToolUseIds = [];
  };

  for (const e of events) {
    const inRange = eventInRange(e.seq, compactions);
    if (inRange) {
      if (!seenCompactions.has(inRange)) {
        seenCompactions.add(inRange);
        flushAssistant();
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: `[summary of earlier turns]\n${inRange.summary}` }],
        });
      }
      continue;
    }

    switch (e.type) {
      case 'user_prompt': {
        flushAssistant();
        const blocks: ContentBlock[] = [{ type: 'text', text: e.text }];
        if (e.attachments) {
          for (const att of e.attachments) {
            if (att.kind === 'image') blocks.push({ type: 'image', mediaType: att.mediaType ?? 'image/png', data: att.content });
            else blocks.push({ type: 'text', text: `[${att.kind}${att.name ? ` ${att.name}` : ''}]\n${att.content}` });
          }
        }
        messages.push({ role: 'user', content: blocks });
        break;
      }
      case 'assistant_message': {
        flushAssistant();
        currentAssistant = [{ type: 'text', text: e.content }];
        break;
      }
      case 'tool_call_requested': {
        currentAssistant ??= [];
        currentAssistant.push({
          type: 'tool_use',
          id: e.callId,
          name: e.name,
          input: e.input,
        });
        currentToolUseIds.push(e.callId);
        break;
      }
      case 'tool_result': {
        if (currentAssistant) {
          messages.push({ role: 'assistant', content: currentAssistant });
          currentAssistant = null;
          currentToolUseIds = [];
        }
        const text = serializeToolOutput(e.output, e.error);
        messages.push({
          role: 'tool_result',
          content: [
            { type: 'tool_result', toolUseId: e.callId, content: text, isError: !e.ok },
          ],
        });
        break;
      }
      default:
        break;
    }
  }
  flushAssistant();

  if (opts.maxEvents && messages.length > opts.maxEvents) {
    return messages.slice(messages.length - opts.maxEvents);
  }
  return messages;
}

function serializeToolOutput(output: unknown, error?: { message: string; kind: string }): string {
  if (error) return `[error:${error.kind}] ${error.message}`;
  if (output == null) return '';
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

