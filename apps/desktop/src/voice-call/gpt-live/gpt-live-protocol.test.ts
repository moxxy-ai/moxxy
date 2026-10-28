import { describe, expect, it } from 'vitest';
import {
  GPT_LIVE_SESSION_CLOSE,
  GptLiveEventReader,
  buildGptLiveDelegationResult,
  buildGptLiveDeveloperContext,
} from './gpt-live-protocol';

// Frames in the shapes of OpenAI's Live API reference (primary WebSocket /
// WebRTC data channel `oai-events`).
const input = (delta: string, at = 0) =>
  JSON.stringify({ type: 'session.input_transcript.delta', event_id: `in_${at}`, delta, start_ms: at, end_ms: at + 100 });
const output = (delta: string, at = 0) =>
  JSON.stringify({ type: 'session.output_transcript.delta', event_id: `out_${at}`, delta, start_ms: at, end_ms: at + 100 });
const delegation = (id: string) => JSON.stringify({
  type: 'session.delegation.created',
  event_id: `evt_${id}`,
  offset_ms: 3600,
  delegation: { id, type: 'delegation', target: 'client' },
});

describe('GptLiveEventReader', () => {
  it('reports the session start', () => {
    const reader = new GptLiveEventReader();
    expect(reader.read(JSON.stringify({ type: 'session.started', event_id: 'e', session: { model: 'gpt-live-1' } })))
      .toEqual([{ type: 'session-started' }]);
  });

  it('builds the user turn from transcript fragments and ends it when the model speaks', () => {
    const reader = new GptLiveEventReader();

    expect(reader.read(input(' Jaka jest', 100))).toEqual([{ type: 'turn-started', role: 'user' }]);
    expect(reader.read(input(' stolica Francji?', 200))).toEqual([]);
    expect(reader.read(output('Stolicą', 300))).toEqual([
      { type: 'turn-done', role: 'user', turnId: 'user_1', text: 'Jaka jest stolica Francji?' },
      { type: 'turn-started', role: 'assistant' },
    ]);
    expect(reader.read(output(' Francji jest Paryż.', 400))).toEqual([]);
    expect(reader.read(input('Dzięki', 900))).toEqual([
      { type: 'turn-done', role: 'assistant', turnId: 'assistant_1', text: 'Stolicą Francji jest Paryż.' },
      { type: 'turn-started', role: 'user' },
    ]);
  });

  it('ends the model turn once it has gone quiet', () => {
    const reader = new GptLiveEventReader();
    reader.read(input('Halo?'));
    reader.read(output('Słucham.'));

    expect(reader.speaking).toBe(true);
    expect(reader.settle()).toEqual([
      { type: 'turn-done', role: 'assistant', turnId: 'assistant_1', text: 'Słucham.' },
    ]);
    expect(reader.speaking).toBe(false);
    expect(reader.settle()).toEqual([]);
  });

  it('ties a delegation to the user turn it came from, ending that turn first', () => {
    const reader = new GptLiveEventReader();
    reader.read(input('Uruchom testy w projekcie.'));

    expect(reader.read(delegation('del_1'))).toEqual([
      { type: 'turn-done', role: 'user', turnId: 'user_1', text: 'Uruchom testy w projekcie.' },
      { type: 'delegation', itemId: 'del_1', userTurnId: 'user_1' },
    ]);
  });

  it('ties a delegation that lands after the model answered to the last user turn', () => {
    const reader = new GptLiveEventReader();
    reader.read(input('Zrób deploy.'));
    reader.read(output('Przekazuję.'));

    expect(reader.read(delegation('del_2'))).toEqual([
      { type: 'turn-done', role: 'assistant', turnId: 'assistant_1', text: 'Przekazuję.' },
      { type: 'delegation', itemId: 'del_2', userTurnId: 'user_1' },
    ]);
  });

  it('finishes open turns before reporting the session closed', () => {
    const reader = new GptLiveEventReader();
    reader.read(input('Halo, jesteś tam?'));

    expect(reader.read(JSON.stringify({ type: 'session.closed', event_id: 'e', reason: 'expired', session: {} })))
      .toEqual([
        { type: 'turn-done', role: 'user', turnId: 'user_1', text: 'Halo, jesteś tam?' },
        { type: 'session-closed', reason: 'expired' },
      ]);
  });

  it('hands back the unfinished turn when the call ends on this side', () => {
    const reader = new GptLiveEventReader();
    reader.read(input('Halo?'));

    expect(reader.end()).toEqual([{ type: 'turn-done', role: 'user', turnId: 'user_1', text: 'Halo?' }]);
    expect(reader.end()).toEqual([]);
  });

  it('surfaces protocol errors', () => {
    const reader = new GptLiveEventReader();
    expect(reader.read(JSON.stringify({
      type: 'error',
      event_id: 'e',
      error: { type: 'invalid_request_error', code: 'unknown_parameter', message: "Unknown parameter: 'session.voice'." },
    }))).toEqual([{ type: 'error', message: "Unknown parameter: 'session.voice'." }]);
  });

  it('ignores bookkeeping, unknown and malformed frames', () => {
    const reader = new GptLiveEventReader();
    expect(reader.read('{"type":"session.usage.updated","event_id":"e","usage":{}}')).toEqual([]);
    expect(reader.read('{"type":"session.thinking.appended","event_id":"e"}')).toEqual([]);
    expect(reader.read('not json')).toEqual([]);
    expect(reader.read('{"type":"session.input_transcript.delta","delta":42}')).toEqual([]);
    expect(reader.read('{"type":"session.delegation.created","delegation":{"id":"d","type":"delegation","target":"responses"}}'))
      .toEqual([]);
  });
});

describe('outbound GPT-Live messages', () => {
  it('adds chat context as silent thinking for the whole session, chunked to 500 bytes', () => {
    const messages = buildGptLiveDeveloperContext('ż'.repeat(400));

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toMatchObject({ type: 'session.thinking.append', delegation_id: null });
      expect(new TextEncoder().encode(message.content).byteLength).toBeLessThanOrEqual(500);
    }
    expect(messages.map((message) => message.content).join('')).toBe('ż'.repeat(400));
  });

  it('returns the agent result to its delegation as speakable commentary, chunked', () => {
    const messages = buildGptLiveDelegationResult('del_1', 'ó'.repeat(300));

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toMatchObject({ type: 'session.commentary.append', delegation_id: 'del_1' });
      expect(new TextEncoder().encode(message.content).byteLength).toBeLessThanOrEqual(500);
    }
    expect(messages.map((message) => message.content).join('')).toBe('ó'.repeat(300));
  });

  it('closes the session explicitly', () => {
    expect(GPT_LIVE_SESSION_CLOSE).toEqual({ type: 'session.close' });
  });
});
