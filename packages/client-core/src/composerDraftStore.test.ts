import { afterEach, describe, expect, it, vi } from 'vitest';

import { composerDraftStore, sendToSession } from './composerDraftStore';
import { connectionStore } from './useConnection';

afterEach(() => {
  // Drain any state these singleton stores carry between tests.
  composerDraftStore.takeDraft('ws-1');
  composerDraftStore.takeDraft('ws-2');
  composerDraftStore.consumeChatViewRequest();
  connectionStore.setActive(null);
  vi.restoreAllMocks();
});

describe('composerDraftStore', () => {
  it('prefill stages a per-workspace draft and raises the chat-view pulse', () => {
    composerDraftStore.prefill('ws-1', 'hello');
    expect(composerDraftStore.peekDraft('ws-1')).toBe('hello');
    expect(composerDraftStore.peekDraft('ws-2')).toBeNull();
    expect(composerDraftStore.peekChatViewRequest()).toBe(true);
  });

  it('peekDraft does not consume; takeDraft consumes once (idempotent)', () => {
    composerDraftStore.prefill('ws-1', 'x');
    expect(composerDraftStore.peekDraft('ws-1')).toBe('x'); // peek leaves it
    expect(composerDraftStore.peekDraft('ws-1')).toBe('x');
    expect(composerDraftStore.takeDraft('ws-1')).toBe('x'); // take returns + clears
    expect(composerDraftStore.takeDraft('ws-1')).toBeNull(); // second take → null
    expect(composerDraftStore.peekDraft('ws-1')).toBeNull();
  });

  it('consumeChatViewRequest clears the pulse', () => {
    composerDraftStore.prefill('ws-1', 'x');
    composerDraftStore.consumeChatViewRequest();
    expect(composerDraftStore.peekChatViewRequest()).toBe(false);
  });

  it('notifies subscribers on prefill and on take', () => {
    const fn = vi.fn();
    const unsub = composerDraftStore.subscribe(fn);
    composerDraftStore.prefill('ws-1', 'x');
    composerDraftStore.takeDraft('ws-1');
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
  });
});

describe('sendToSession', () => {
  it('is a no-op returning false when there is no active workspace', () => {
    connectionStore.setActive(null);
    expect(sendToSession({ text: 'hi' })).toBe(false);
    expect(composerDraftStore.peekChatViewRequest()).toBe(false);
  });

  it('prefills the ACTIVE workspace and returns true', () => {
    connectionStore.setActive('ws-1');
    expect(sendToSession({ text: 'hi' })).toBe(true);
    expect(composerDraftStore.peekDraft('ws-1')).toBe('hi');
  });

  it('folds title into a leading line; body unchanged without a title', () => {
    connectionStore.setActive('ws-1');
    sendToSession({ text: 'BODY', title: 'Redacted document' });
    expect(composerDraftStore.takeDraft('ws-1')).toBe('Redacted document\n\nBODY');

    sendToSession({ text: 'BODY' });
    expect(composerDraftStore.takeDraft('ws-1')).toBe('BODY');
  });
});
