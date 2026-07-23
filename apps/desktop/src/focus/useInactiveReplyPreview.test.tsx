import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatStore } from '@moxxy/client-core';
import { asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { useInactiveReplyPreview } from './useInactiveReplyPreview';

const WORKSPACE_ID = 'focus-reply-preview-test';

function event(
  seq: number,
  patch: Partial<MoxxyEvent> & { readonly type: MoxxyEvent['type']; readonly turnId: string },
): MoxxyEvent {
  return {
    id: `reply-${seq}`,
    seq,
    ts: seq,
    sessionId: 'session-focus-reply',
    ...patch,
  } as MoxxyEvent;
}

function dispatch(next: MoxxyEvent): void {
  chatStore.dispatch(WORKSPACE_ID, { type: 'event', event: next });
}

beforeEach(() => {
  vi.useFakeTimers();
  chatStore.drop(WORKSPACE_ID);
});

afterEach(() => {
  cleanup();
  chatStore.drop(WORKSPACE_ID);
  vi.useRealTimers();
});

describe('useInactiveReplyPreview', () => {
  it('keeps a final answer visible for 15 seconds', async () => {
    const { result } = renderHook(() => useInactiveReplyPreview({
      stage: 'inactive',
      workspaceId: WORKSPACE_ID,
    }));

    act(() => chatStore.dispatch(WORKSPACE_ID, {
      type: 'send_started',
      turnId: asTurnId('turn-final'),
    }));
    act(() => dispatch(event(1, {
      type: 'assistant_chunk',
      turnId: asTurnId('turn-final'),
      delta: 'Final answer',
    })));
    act(() => dispatch(event(2, {
      type: 'assistant_message',
      turnId: asTurnId('turn-final'),
      source: 'model',
      content: 'Final answer',
      stopReason: 'end_turn',
    })));
    act(() => chatStore.dispatch(WORKSPACE_ID, {
      type: 'turn_complete',
      turnId: asTurnId('turn-final'),
      error: null,
    }));

    expect(result.current.preview?.text).toBe('Final answer');
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(result.current.preview?.text).toBe('Final answer');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.preview).toBeNull();
  });

  it('pins a clicked final answer until the next user turn', () => {
    const { result } = renderHook(() => useInactiveReplyPreview({
      stage: 'active',
      workspaceId: WORKSPACE_ID,
    }));

    act(() => chatStore.dispatch(WORKSPACE_ID, {
      type: 'send_started',
      turnId: asTurnId('turn-pinned'),
    }));
    act(() => dispatch(event(1, {
      type: 'assistant_chunk',
      turnId: asTurnId('turn-pinned'),
      delta: 'Pinned answer',
    })));
    act(() => dispatch(event(2, {
      type: 'assistant_message',
      turnId: asTurnId('turn-pinned'),
      source: 'model',
      content: 'Pinned answer',
      stopReason: 'end_turn',
    })));
    act(() => result.current.pinPreview());
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.preview?.text).toBe('Pinned answer');

    act(() => dispatch(event(3, {
      type: 'user_prompt',
      turnId: asTurnId('turn-next'),
      source: 'user',
      text: 'Next question',
    })));
    expect(result.current.preview).toBeNull();
  });

  it('does not present a tool-use message as the final answer', () => {
    const { result } = renderHook(() => useInactiveReplyPreview({
      stage: 'inactive',
      workspaceId: WORKSPACE_ID,
    }));

    act(() => dispatch(event(1, {
      type: 'assistant_chunk',
      turnId: asTurnId('turn-tool'),
      delta: 'I will inspect that now.',
    })));
    expect(result.current.preview).not.toBeNull();

    act(() => dispatch(event(2, {
      type: 'assistant_message',
      turnId: asTurnId('turn-tool'),
      source: 'model',
      content: 'I will inspect that now.',
      stopReason: 'tool_use',
    })));
    expect(result.current.preview).toBeNull();
  });
});
