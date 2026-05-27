import type {
  EventLogReader,
  PendingToolCall,
  ToolCallId,
  TurnId,
} from '@moxxy/sdk';

export type { PendingToolCall };

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

