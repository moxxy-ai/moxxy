/** The conversation as Moxxy keeps it: what a new agent session starts from, and what `recall` searches. */
import { describe, expect, it } from 'vitest';
import { conversationTurns, renderEarlierConversation, renderMissedTurns, searchConversation } from './conversation-history.js';
import type { MoxxyEvent, MoxxyEventOfType, MoxxyEventType } from './events.js';
import { asEventId, asSessionId, asToolCallId, asTurnId, type TurnId } from './ids.js';
import type { EventLogReader } from './log.js';

const sid = asSessionId('s1');

function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  return {
    length: events.length,
    at: (seq) => events[seq],
    slice: (from = 0, to = events.length) => events.slice(from, to),
    ofType: <T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> =>
      events.filter((e): e is MoxxyEventOfType<T> => e.type === type),
    byTurn: (turnId: TurnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

/** A log built turn by turn: what the person said, what the agent did and answered. */
function conversation(
  turns: ReadonlyArray<{ said: string; reply?: string; tool?: { name: string; input: unknown }; checkpoint?: string; provider?: string }>,
): MoxxyEvent[] {
  const events: MoxxyEvent[] = [];
  const push = (turnId: TurnId, partial: Record<string, unknown>) => {
    const seq = events.length;
    events.push({ id: asEventId(`e${seq}`), seq, ts: seq, sessionId: sid, turnId, ...partial } as MoxxyEvent);
  };
  turns.forEach((turn, index) => {
    const turnId = asTurnId(`t${index + 1}`);
    push(turnId, { type: 'user_prompt', source: 'user', text: turn.said });
    if (turn.provider) push(turnId, { type: 'provider_request', source: 'system', provider: turn.provider, model: 'm' });
    if (turn.tool) {
      push(turnId, { type: 'tool_call_requested', source: 'model', callId: asToolCallId(`c${index}`), name: turn.tool.name, input: turn.tool.input });
      push(turnId, { type: 'tool_result', source: 'tool', callId: asToolCallId(`c${index}`), ok: true, output: 'SECRET TOOL OUTPUT' });
    }
    if (turn.checkpoint) push(turnId, { type: 'user_prompt', source: 'system', text: turn.checkpoint, origin: { kind: 'checkpoint', name: 'x' } });
    if (turn.reply) push(turnId, { type: 'assistant_message', source: 'model', content: turn.reply, stopReason: 'end_turn' });
  });
  return events;
}

describe('the turns of a conversation', () => {
  it('reads each turn the person started: their words, the replies and the tools, never tool output or checkpoints', () => {
    const log = reader(
      conversation([
        { said: 'Set the database to port 5433', tool: { name: 'Edit', input: { file_path: 'db/config.ts' } }, checkpoint: 'Continue.', reply: 'Done: 5433.' },
        { said: 'Thanks' },
      ]),
    );

    const turns = conversationTurns(log);

    expect(turns.map((turn) => turn.number)).toEqual([1, 2]);
    expect(turns[0]).toMatchObject({ said: ['Set the database to port 5433'], replies: ['Done: 5433.'], tools: ['Edit db/config.ts'] });
    expect(turns[0]?.text).not.toContain('SECRET TOOL OUTPUT');
    expect(turns[0]?.text).not.toContain('Continue.');
  });
});

describe('what a new agent session gets of the conversation', () => {
  it('is nothing on the first turn', () => {
    const log = reader(conversation([{ said: 'Hello' }]));

    expect(renderEarlierConversation(log, asTurnId('t1'))).toBeUndefined();
  });

  it('gives the earlier turns word for word, as history and not a request, and leaves out the turn running now', () => {
    const log = reader(conversation([{ said: 'Use port 5433', reply: 'OK, 5433.' }, { said: 'What port did we pick?' }]));

    const text = renderEarlierConversation(log, asTurnId('t2')) ?? '';

    expect(text).toContain('not a new request');
    expect(text).toContain('### Turn 1\nPerson: Use port 5433\nAgent: OK, 5433.');
    expect(text).not.toContain('What port did we pick?');
  });

  it('keeps within its budget on a long conversation: the latest turns whole, a line for each older one', () => {
    const turns = Array.from({ length: 300 }, (_, i) => ({ said: `Request ${i + 1}: ${'detail '.repeat(40)}`, reply: 'answer '.repeat(200) }));
    turns[11] = { said: 'Set the database to port 5433', reply: 'Done.' };
    const log = reader(conversation([...turns, { said: 'What port?' }]));

    const text = renderEarlierConversation(log, asTurnId('t301'), 64_000) ?? '';

    expect(text.length).toBeLessThan(66_000);
    expect(text).toContain('### Turn 300');
    expect(text).toContain('call recall before you answer');
    expect(text).toContain('Never say you do not know, or offer to look, without searching first.');
    expect(text).not.toContain('### Turn 12\n');
    expect(text).toContain('- turn 1: Request 1');
    expect(text).toMatch(/- turns \d+–\d+: not listed here; recall with a query finds them/);
  });

  it('cuts one turn too long for the budget and says how to read the rest', () => {
    const log = reader(conversation([{ said: 'x'.repeat(50_000) }, { said: 'next' }]));

    const text = renderEarlierConversation(log, asTurnId('t2'), 2_000) ?? '';

    expect(text.length).toBeLessThan(2_600);
    expect(text).toContain('recall({ turn: 1 })');
  });
});

describe('what an agent coming back to the conversation gets of the turns it missed', () => {
  it('is nothing when it never ran in this conversation: a new session of its own gets the whole conversation instead', () => {
    const log = reader(conversation([{ said: 'Use port 5433', provider: 'codex-agent' }, { said: 'Which port?' }]));

    expect(renderMissedTurns(log, 'claude-code', asTurnId('t2'))).toBeUndefined();
  });

  it('is nothing when it ran the turn before this one', () => {
    const log = reader(conversation([{ said: 'Use port 5433', provider: 'claude-code' }, { said: 'Which port?', provider: 'claude-code' }]));

    expect(renderMissedTurns(log, 'claude-code', asTurnId('t2'))).toBeUndefined();
  });

  it('gives, word for word and as history, only the turns another connection ran since its own last turn', () => {
    const log = reader(
      conversation([
        { said: 'Use port 5433', reply: 'OK.', provider: 'claude-code' },
        { said: 'Rename the table to orders', reply: 'Renamed it to orders.', provider: 'codex-agent' },
        { said: 'And add an index', reply: 'Index added.', provider: 'anthropic' },
        { said: 'What did Codex rename?', provider: 'claude-code' },
      ]),
    );

    const text = renderMissedTurns(log, 'claude-code', asTurnId('t4')) ?? '';

    expect(text).toContain('another connection');
    expect(text).toContain('not a new request');
    expect(text).toContain('### Turn 2\nPerson: Rename the table to orders\nAgent: Renamed it to orders.');
    expect(text).toContain('### Turn 3\nPerson: And add an index\nAgent: Index added.');
    expect(text).not.toContain('Use port 5433');
    expect(text).not.toContain('What did Codex rename?');
  });

  it("ends by saying the record is over and the person's newest message comes next, so it is not taken for part of the record", () => {
    const log = reader(
      conversation([
        { said: 'Use port 5433', reply: 'OK.', provider: 'claude-code' },
        { said: 'Answer with OK', reply: 'OK', provider: 'codex-agent' },
        { said: 'Create notes.txt', provider: 'claude-code' },
      ]),
    );

    for (const text of [renderMissedTurns(log, 'claude-code', asTurnId('t3')), renderEarlierConversation(log, asTurnId('t3'))]) {
      expect(text).toMatch(/End of Moxxy's record\. The person's newest message comes next: that is the request to act on\.$/);
    }
  });
});

describe('searching the conversation', () => {
  const log = reader(
    conversation([
      { said: 'Ustawmy bazę na porcie 5433', reply: 'Zrobione.' },
      { said: 'Add a login page', tool: { name: 'Write', input: { file_path: 'src/login.tsx', content: 'export function Login() {}' } }, reply: 'Added.' },
      { said: 'jaki port bazy ustaliliśmy?' },
    ]),
  );

  it('finds a turn by words in another form (port, porcie; bazy, bazę)', () => {
    const [first] = searchConversation(log, 'port bazy', { exceptTurnId: asTurnId('t3') });

    expect(first?.turn.number).toBe(1);
    expect(first?.snippets.join(' ')).toContain('5433');
  });

  it('shows words that stand close together in one snippet', () => {
    const [first] = searchConversation(log, 'baza port 5433', { exceptTurnId: asTurnId('t3') });

    expect(first?.snippets).toHaveLength(1);
  });

  it('finds what a tool was given, such as a file it wrote', () => {
    expect(searchConversation(log, 'login.tsx')[0]?.turn.number).toBe(2);
  });

  it('leaves out the turn asking and finds nothing for words never said', () => {
    expect(searchConversation(log, 'ustaliliśmy', { exceptTurnId: asTurnId('t3') })).toEqual([]);
    expect(searchConversation(log, 'kubernetes')).toEqual([]);
  });
});
