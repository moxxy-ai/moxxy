/**
 * Tests for the chat reducer's user_prompt handling. The reducer
 * needs to:
 *
 *   1. Add a user block locally when `send_started` is dispatched
 *      (the originating window's immediate UI feedback).
 *   2. Add a user block from the `user_prompt` runner event for
 *      windows that DIDN'T originate the send — that's what makes
 *      the focus widget → main window sync work.
 *   3. NOT double-add when both fire on the originating window —
 *      checked via "last block is user with same text → skip".
 */

import { describe, it, expect } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import {
  chatReducer,
  initialChatState,
  type ChatAction,
  type ChatState,
} from './chatReducer';

const userPromptEvent = (text: string): MoxxyEvent =>
  ({ type: 'user_prompt', text, turnId: 't1', seq: 1 } as unknown as MoxxyEvent);

const sendStarted = (text: string, turnId = 't1'): ChatAction => ({
  type: 'send_started',
  turnId,
  prompt: text,
});

describe('chatReducer user_prompt handling', () => {
  it('adds a user block on send_started locally (originating window)', () => {
    const next = chatReducer(initialChatState, sendStarted('hi'));
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]?.kind).toBe('user');
    expect((next.blocks[0] as { text: string }).text).toBe('hi');
    expect(next.sending).toBe(true);
  });

  it('skips user_prompt event when last block already matches (dedup)', () => {
    const afterSend = chatReducer(initialChatState, sendStarted('hi'));
    const afterEvent = chatReducer(afterSend, {
      type: 'event',
      event: userPromptEvent('hi'),
    });
    // Should not have added a second user block.
    expect(afterEvent.blocks).toHaveLength(1);
    expect(afterEvent.blocks[0]?.kind).toBe('user');
  });

  it('adds user block from user_prompt when no local send_started fired (secondary window)', () => {
    // This is the cross-window case: the main window did NOT call
    // send_started (the focus widget did) but the user_prompt event
    // arrives via runner.event IPC. The main window's reducer should
    // add the block so the main transcript shows the user's
    // message.
    const next = chatReducer(initialChatState, {
      type: 'event',
      event: userPromptEvent('hello from focus widget'),
    });
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]?.kind).toBe('user');
    expect((next.blocks[0] as { text: string }).text).toBe(
      'hello from focus widget',
    );
  });

  it('adds user block when last block is assistant (not a duplicate)', () => {
    const state: ChatState = {
      ...initialChatState,
      blocks: [
        { kind: 'assistant', id: 'a-0', text: 'prior response', streaming: false },
      ],
      seq: 1,
    };
    const next = chatReducer(state, {
      type: 'event',
      event: userPromptEvent('new turn'),
    });
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[1]?.kind).toBe('user');
    expect((next.blocks[1] as { text: string }).text).toBe('new turn');
  });
});
