/** What a chat is doing; a chat that is doing nothing is left out of the map. */
export type SessionActivity = 'working' | 'asking';

/** A chat that wants the person back. */
export interface Call {
  readonly sessionId: string;
  readonly reason: 'answered' | 'asked';
}

/**
 * The chats that started to want the person between two readings: one that
 * finished its answer, or one that stopped to ask. A chat that is gone from the
 * list did not finish: it was removed.
 */
export function callsForAttention({
  before,
  after,
  known,
}: {
  readonly before: ReadonlyMap<string, SessionActivity>;
  readonly after: ReadonlyMap<string, SessionActivity>;
  /** Every chat in the list now. */
  readonly known: ReadonlySet<string>;
}): Call[] {
  const calls: Call[] = [];
  for (const sessionId of new Set([...before.keys(), ...after.keys()])) {
    if (!known.has(sessionId)) continue;
    const now = after.get(sessionId);
    if (now === 'asking' && before.get(sessionId) !== 'asking') calls.push({ sessionId, reason: 'asked' });
    else if (now === undefined && before.has(sessionId)) calls.push({ sessionId, reason: 'answered' });
  }
  return calls;
}
