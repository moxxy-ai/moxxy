import { describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import {
  GPT_LIVE_CHAT_CONTEXT_MAX_CHARS,
  chatEventToGptLiveContext,
  GptLiveChatMirror,
} from './gpt-live-chat-context';

function event(turnId: string, body: Record<string, unknown>): MoxxyEvent {
  return {
    id: asEventId(`event-${turnId}-${String(body.type)}`),
    seq: 1,
    ts: 1,
    sessionId: asSessionId('session-1'),
    turnId: asTurnId(turnId),
    ...body,
  } as MoxxyEvent;
}

describe('chatEventToGptLiveContext', () => {
  it('describes a message typed in the chat during the call', () => {
    expect(chatEventToGptLiveContext(
      event('typed', { type: 'user_prompt', source: 'user', text: 'Mój kolor to zielony.' }),
      new Set(),
    )).toBe('The user wrote in the Moxxy chat: Mój kolor to zielony.');
  });

  it('describes the agent reply that lands in the chat during the call', () => {
    expect(chatEventToGptLiveContext(
      event('agent', {
        type: 'assistant_message',
        source: 'model',
        content: 'Testy przeszły.',
        stopReason: 'end_turn',
      }),
      new Set(),
    )).toBe('The Moxxy agent replied in the chat: Testy przeszły.');
  });

  it('skips the voice exchanges this call recorded itself', () => {
    expect(chatEventToGptLiveContext(
      event('voice-turn', { type: 'user_prompt', source: 'user', text: 'Halo?' }),
      new Set(['voice-turn']),
    )).toBeNull();
  });

  it('skips tool traffic, checkpoints and blank messages', () => {
    expect(chatEventToGptLiveContext(
      event('t', { type: 'tool_result', source: 'tool', callId: 'c', output: 'x' }),
      new Set(),
    )).toBeNull();
    expect(chatEventToGptLiveContext(
      event('t', { type: 'user_prompt', source: 'user', text: 'verify', origin: { kind: 'checkpoint', name: 'v' } }),
      new Set(),
    )).toBeNull();
    expect(chatEventToGptLiveContext(
      event('t', { type: 'assistant_message', source: 'model', content: '  ', stopReason: 'end_turn' }),
      new Set(),
    )).toBeNull();
  });

  it('bounds a long chat message', () => {
    const text = chatEventToGptLiveContext(
      event('t', { type: 'assistant_message', source: 'model', content: 'a'.repeat(20_000), stopReason: 'end_turn' }),
      new Set(),
    );

    expect(text?.length).toBeLessThanOrEqual(GPT_LIVE_CHAT_CONTEXT_MAX_CHARS);
    expect(text?.endsWith('…')).toBe(true);
  });
});

describe('GptLiveChatMirror', () => {
  it('forwards messages from the chat but never echoes the exchanges the call recorded', () => {
    const mirror = new GptLiveChatMirror();
    mirror.expectRecorded({ userText: 'Halo?', assistantText: 'Słucham.' });

    const ownPrompt = event('voice', { type: 'user_prompt', source: 'user', text: 'Halo?' });
    const ownReply = event('voice', {
      type: 'assistant_message',
      source: 'model',
      content: 'Słucham.',
      stopReason: 'end_turn',
    });
    expect(mirror.contextFor(ownPrompt)).toBeNull();
    expect(mirror.contextFor(ownReply)).toBeNull();

    expect(mirror.contextFor(event('typed', { type: 'user_prompt', source: 'user', text: 'Halo?' })))
      .toBe('The user wrote in the Moxxy chat: Halo?');
  });

  it('ignores a replayed event it has already seen', () => {
    const mirror = new GptLiveChatMirror();
    const typed = event('typed', { type: 'user_prompt', source: 'user', text: 'Zielony.' });

    expect(mirror.contextFor(typed)).not.toBeNull();
    expect(mirror.contextFor(typed)).toBeNull();
  });
});
