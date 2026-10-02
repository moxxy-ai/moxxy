import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EventLogReader, MoxxyEvent, SessionId, ToolCallId, ToolContext, TurnId } from '@moxxy/sdk';

/** The scripted helper process used by backend tests (a real child process, not a stub). */
export const contractHelperScript = fileURLToPath(new URL('./contract-helper.fixture.mjs', import.meta.url));

/** An in-memory, append-only event log reader over a plain array. */
export function memoryLog(events: MoxxyEvent[]): EventLogReader {
  return {
    get length() { return events.length; },
    at: (index) => events[index],
    slice: (from, to) => events.slice(from, to),
    ofType: ((type: MoxxyEvent['type']) => events.filter((event) => event.type === type)) as EventLogReader['ofType'],
    byTurn: (turnId) => events.filter((event) => event.turnId === turnId),
    toJSON: () => events,
  };
}

export function toolContext(log: EventLogReader, opts: { sessionId?: string; turnId?: string; callId?: string; signal?: AbortSignal; getSecret?: ToolContext['getSecret'] } = {}): ToolContext {
  const quiet = () => undefined;
  return {
    sessionId: (opts.sessionId ?? 'session') as SessionId,
    turnId: (opts.turnId ?? 'turn') as TurnId,
    callId: (opts.callId ?? 'call') as ToolCallId,
    cwd: process.cwd(),
    signal: opts.signal ?? new AbortController().signal,
    log,
    logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
    ...(opts.getSecret ? { getSecret: opts.getSecret } : {}),
  };
}

/** Methods the helper received, in order. */
export function helperRequests(file: string): Array<{ method: string; params: Record<string, unknown> }> {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
}
