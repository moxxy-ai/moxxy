import { describe, expect, it } from 'vitest';
import {
  GPT_LIVE_SESSION_CLOSE,
  buildGptLiveDelegationNotice,
  buildGptLiveDelegationResult,
  buildGptLiveDeveloperContext,
  parseGptLiveEvent,
} from './gpt-live-protocol';

// Payloads below were captured verbatim from a live GPT-Live call.
describe('parseGptLiveEvent', () => {
  it('reads the session start', () => {
    expect(parseGptLiveEvent(
      '{"type":"session.started","session":{"id":"rtc_u32_ETCRZp3oN5zeME7AqoW9SLcJTYbQ5Vvy","status":"active","expires_at":1790635253}}',
    )).toEqual({ type: 'session-started' });
  });

  it('reads streamed user and assistant transcript fragments', () => {
    expect(parseGptLiveEvent(
      '{"type":"input_transcript.added","end_ms":3200,"item":{"id":"item_ETCRdpgteMjY6ZZJ8c1Og","type":"input_transcript","text":"! Jaka"},"start_ms":3000}',
    )).toEqual({ type: 'transcript', role: 'user', text: '! Jaka' });
    expect(parseGptLiveEvent(
      '{"type":"output_transcript.added","end_ms":5200,"item":{"id":"item_ETCRfAiSpNy6ohGrpV2Y9","type":"output_transcript","text":" Francji"},"start_ms":5000}',
    )).toEqual({ type: 'transcript', role: 'assistant', text: ' Francji' });
  });

  it('reads turn boundaries with their role and final transcript', () => {
    expect(parseGptLiveEvent(
      '{"type":"turn.created","turn":{"id":"turn_ETCRfzGdHu1dfDGoBvCcg","end_ms":5400,"role":"assistant","start_ms":5200,"transcript":" Cześć! Stolicą Francji"}}',
    )).toEqual({ type: 'turn-started', role: 'assistant' });
    expect(parseGptLiveEvent(
      '{"type":"turn.done","turn":{"id":"turn_ETCRdPzQhxVRIFOvi23vr","end_ms":5400,"role":"user","start_ms":2400,"transcript":" Cześć! Jaka jest stolica Francji?"}}',
    )).toEqual({
      type: 'turn-done',
      role: 'user',
      turnId: 'turn_ETCRdPzQhxVRIFOvi23vr',
      text: 'Cześć! Jaka jest stolica Francji?',
    });
  });

  it('reads a client delegation with the user turn it came from', () => {
    expect(parseGptLiveEvent(
      '{"type":"delegation.created","item":{"id":"item_ETCr3x82MHn91eIU0lh1l","type":"delegation","content":[{"type":"input_text","text":"Uruchom testy w projekcie."}],"handoff_id":"handoff_1","target":"client","user_bidi_turn_id":"turn_ETCr2XCd3Im1Bc6U83sbt"},"offset_ms":3400}',
    )).toEqual({
      type: 'delegation',
      itemId: 'item_ETCr3x82MHn91eIU0lh1l',
      userTurnId: 'turn_ETCr2XCd3Im1Bc6U83sbt',
    });
    expect(parseGptLiveEvent(
      '{"type":"delegation.created","item":{"id":"handoff-123","type":"delegation","target":"client","content":[]}}',
    )).toEqual({ type: 'delegation', itemId: 'handoff-123', userTurnId: null });
  });

  it('reads protocol errors and the session close', () => {
    expect(parseGptLiveEvent(
      '{"type":"error","event_id":"event_1","error":{"type":"invalid_request_error","code":"invalid_value","message":"Invalid value: \'zzz\'."}}',
    )).toEqual({ type: 'error', message: "Invalid value: 'zzz'." });
    expect(parseGptLiveEvent(
      '{"type":"session.closed","reason":"client_request","usage":{"audio_duration_ms":30600,"backend_model_usage":[]}}',
    )).toEqual({ type: 'session-closed', reason: 'client_request' });
  });

  it('ignores bookkeeping, unknown and malformed frames', () => {
    expect(parseGptLiveEvent('{"type":"session.usage.updated","usage":{"audio_duration_ms":0}}')).toBeNull();
    expect(parseGptLiveEvent('{"type":"turn.delta","delta":"arańc","turn_id":"turn_1"}')).toBeNull();
    expect(parseGptLiveEvent('not json')).toBeNull();
    expect(parseGptLiveEvent('{"type":"turn.done","turn":{"role":"narrator"}}')).toBeNull();
  });
});

describe('outbound GPT-Live messages', () => {
  it('adds chat context on the silent developer channel, chunked to 500 bytes', () => {
    const messages = buildGptLiveDeveloperContext('ż'.repeat(400));

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toMatchObject({ type: 'session.context.append', channel: 'developer' });
      expect(new TextEncoder().encode(message.content[0].text).byteLength).toBeLessThanOrEqual(500);
    }
    expect(messages.map((message) => message.content[0].text).join('')).toBe('ż'.repeat(400));
  });

  it('returns the agent result to the delegation on the speakable channel, chunked', () => {
    const messages = buildGptLiveDelegationResult('item_1', 'ó'.repeat(300));

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toMatchObject({
        type: 'delegation.context.append',
        delegation_item_id: 'item_1',
        channel: 'speakable',
      });
      expect(new TextEncoder().encode(message.content[0].text).byteLength).toBeLessThanOrEqual(500);
    }
    expect(messages.map((message) => message.content[0].text).join('')).toBe('ó'.repeat(300));
  });

  it('tells GPT-Live a delegation is waiting on the commentary channel, leaving it open', () => {
    expect(buildGptLiveDelegationNotice('item_1', 'Queued.')).toEqual([{
      type: 'delegation.context.append',
      delegation_item_id: 'item_1',
      channel: 'commentary',
      content: [{ type: 'input_text', text: 'Queued.' }],
    }]);
  });

  it('closes the session explicitly', () => {
    expect(GPT_LIVE_SESSION_CLOSE).toEqual({ type: 'session.close' });
  });
});
