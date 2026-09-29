import { describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { voiceAgentWork } from './voice-agent-work';

function event(turnId: string, ts: number, body: Record<string, unknown>): MoxxyEvent {
  return {
    id: asEventId(`${turnId}-${ts}`),
    seq: ts,
    ts,
    sessionId: asSessionId('session-1'),
    turnId: asTurnId(turnId),
    ...body,
  } as MoxxyEvent;
}

const prompt = event('turn_1', 10_000, { type: 'user_prompt', source: 'user', text: 'Zapisz plik.' });
const toolResult = event('turn_1', 40_000, { type: 'tool_result', source: 'tool', callId: 'c1', output: 'ok', ok: true });
const earlier = event('turn_0', 90_000, { type: 'user_prompt', source: 'user', text: 'Inna tura.' });

describe('voiceAgentWork', () => {
  it('reports nothing while no agent turn is running', () => {
    expect(voiceAgentWork({ sending: false, activeTurnId: null, streamingText: '', events: [prompt] }, 50_000))
      .toBeNull();
  });

  it('says the agent is thinking, timed from its last visible step', () => {
    expect(voiceAgentWork({
      sending: true,
      activeTurnId: 'turn_1',
      streamingText: '',
      events: [earlier, prompt, toolResult],
    }, 105_000)).toEqual({ label: 'Agent thinking', elapsed: '1:05' });
  });

  it('says the agent is writing once its reply streams in', () => {
    expect(voiceAgentWork({
      sending: true,
      activeTurnId: 'turn_1',
      streamingText: 'Gotowe — ',
      events: [prompt],
    }, 15_000)).toEqual({ label: 'Agent writing a reply', elapsed: '0:05' });
  });

  it('shows the state without a timer before the turn has any event', () => {
    expect(voiceAgentWork({ sending: true, activeTurnId: null, streamingText: '', events: [] }, 1_000))
      .toEqual({ label: 'Agent thinking', elapsed: null });
  });
});
