import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { chatStore } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { useLiveSessions } from './useLiveSessions';

let seq = 0;
function event(type: string, turnId: string, extra: Record<string, unknown>): MoxxyEvent {
  seq += 1;
  return { type, id: `e${seq}`, seq, ts: seq, sessionId: 's', turnId, ...extra } as unknown as MoxxyEvent;
}

const IDS = ['live-a', 'live-b'];

afterEach(() => {
  for (const id of IDS) chatStore.drop(id);
});

describe('useLiveSessions', () => {
  it('knows nothing about a conversation this window has not loaded', () => {
    const { result } = renderHook(() => useLiveSessions(IDS));
    expect(result.current.latest.size).toBe(0);
    expect(result.current.running.size).toBe(0);
  });

  it('follows the newest message of each loaded conversation', () => {
    const { result } = renderHook(() => useLiveSessions(IDS));
    act(() => {
      chatStore.dispatch('live-a', {
        type: 'event',
        event: event('user_prompt', 't1', { text: 'run the tests', source: 'user' }),
      });
    });
    expect(result.current.latest.get('live-a')).toBe('run the tests');
    act(() => {
      chatStore.dispatch('live-a', {
        type: 'event',
        event: event('assistant_message', 't1', { content: 'Nothing failed.', stopReason: 'end_turn' }),
      });
    });
    expect(result.current.latest.get('live-a')).toBe('Nothing failed.');
    expect(result.current.latest.has('live-b')).toBe(false);
  });

  it('marks a conversation as working while its turn runs, and not after', () => {
    const { result } = renderHook(() => useLiveSessions(IDS));
    act(() => chatStore.dispatch('live-b', { type: 'send_started', turnId: 't9' }));
    expect([...result.current.running]).toEqual(['live-b']);
    act(() => chatStore.dispatch('live-b', { type: 'turn_complete', turnId: 't9', error: null }));
    expect(result.current.running.size).toBe(0);
  });

  it('hands back the same object while nothing it reports has changed', () => {
    const { result, rerender } = renderHook(() => useLiveSessions(IDS));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
