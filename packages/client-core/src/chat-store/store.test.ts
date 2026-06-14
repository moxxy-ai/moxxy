/**
 * chatStore singleton tests — drive the live per-workspace reducer/queue/usage
 * fold directly (no React render). Each test uses a unique workspace id so the
 * module-level singleton stays isolated between cases.
 */

import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { ChatPersistence } from '../chatPersistence.js';
import { chatStore } from './store.js';

let nextId = 0;
function ws(): string {
  nextId += 1;
  return `ws-${nextId}`;
}

let evtSeq = 0;
function evt(type: MoxxyEvent['type'], extra: Record<string, unknown> = {}): MoxxyEvent {
  evtSeq += 1;
  return {
    id: `e${evtSeq}`,
    seq: evtSeq,
    ts: evtSeq,
    turnId: 'T1',
    sessionId: 'S',
    source: 'model',
    type,
    ...extra,
  } as unknown as MoxxyEvent;
}
const userPrompt = (text: string, turnId = 'T1'): MoxxyEvent =>
  evt('user_prompt', { text, turnId });
const assistant = (content: string, turnId = 'T1'): MoxxyEvent =>
  evt('assistant_message', { content, stopReason: 'end_turn', turnId });
const providerResponse = (usage: Record<string, unknown>, turnId = 'T1'): MoxxyEvent =>
  evt('provider_response', { provider: 'p', model: 'm', turnId, ...usage });
const compaction = (tokensSaved: number, turnId = 'T1'): MoxxyEvent =>
  evt('compaction', { tokensSaved, turnId });

describe('chatStore slot isolation', () => {
  it('keeps each workspace transcript independent', () => {
    const a = ws();
    const b = ws();
    chatStore.dispatch(a, { type: 'event', event: userPrompt('hello A') });
    chatStore.dispatch(b, { type: 'event', event: userPrompt('hello B') });

    const snapA = chatStore.getChat(a);
    const snapB = chatStore.getChat(b);
    expect(snapA.events).toHaveLength(1);
    expect(snapB.events).toHaveLength(1);
    expect(snapA.events[0]!.id).not.toBe(snapB.events[0]!.id);
    // A's events never leak into B's snapshot.
    expect(snapA.events[0]!.id).not.toBe(snapB.events[0]!.id);
  });

  it('returns the shared EMPTY_SNAPSHOT for an unseen workspace', () => {
    const snap = chatStore.getChat('never-touched');
    expect(snap.isEmpty).toBe(true);
    expect(snap.events).toEqual([]);
  });
});

describe('chatStore queue', () => {
  it('enqueues with unique ids and dequeues FIFO via shiftQueue', () => {
    const id = ws();
    const q1 = chatStore.enqueue(id, 'first');
    const q2 = chatStore.enqueue(id, 'second');
    expect(q1).not.toBe(q2);
    expect(chatStore.getQueue(id).map((q) => q.prompt)).toEqual(['first', 'second']);

    const head = chatStore.shiftQueue(id);
    expect(head?.prompt).toBe('first');
    expect(chatStore.getQueue(id).map((q) => q.prompt)).toEqual(['second']);

    const next = chatStore.shiftQueue(id);
    expect(next?.prompt).toBe('second');
    expect(chatStore.shiftQueue(id)).toBeNull();
  });

  it('drops a queued turn by id', () => {
    const id = ws();
    const q1 = chatStore.enqueue(id, 'keep');
    const q2 = chatStore.enqueue(id, 'drop');
    chatStore.dropFromQueue(id, q2);
    expect(chatStore.getQueue(id).map((q) => q.id)).toEqual([q1]);
  });

  it('carries attachments only when non-empty', () => {
    const id = ws();
    chatStore.enqueue(id, 'with', [{ path: '/a', name: 'a' }]);
    chatStore.enqueue(id, 'without', []);
    const [a, b] = chatStore.getQueue(id);
    expect(a!.attachments).toEqual([{ path: '/a', name: 'a' }]);
    expect(b!.attachments).toBeUndefined();
  });
});

describe('chatStore hidden turns', () => {
  it('drops events tagged with a hidden turn id from the transcript', () => {
    const id = ws();
    chatStore.hideTurn('bg-turn');
    chatStore.dispatch(id, {
      type: 'event',
      event: userPrompt('background', 'bg-turn'),
    });
    expect(chatStore.getChat(id).events).toHaveLength(0);
    // A visible turn still lands.
    chatStore.dispatch(id, { type: 'event', event: userPrompt('visible', 'T-vis') });
    expect(chatStore.getChat(id).events).toHaveLength(1);
  });

  it('unhides automatically on the hidden turn_complete and stops hiding', () => {
    const id = ws();
    chatStore.hideTurn('bg-turn');
    chatStore.dispatch(id, { type: 'turn_complete', turnId: 'bg-turn', error: null });
    // After completion the turn id is no longer hidden — subsequent events show.
    chatStore.dispatch(id, { type: 'event', event: userPrompt('after', 'bg-turn') });
    expect(chatStore.getChat(id).events).toHaveLength(1);
  });
});

describe('chatStore unread tracking', () => {
  it('marks a non-active workspace unread once its rev advances past lastSeenRev', () => {
    const active = ws();
    const bg = ws();
    chatStore.setActive(active);

    expect(chatStore.hasUnread(bg)).toBe(false);
    chatStore.dispatch(bg, { type: 'event', event: userPrompt('ping') });
    expect(chatStore.hasUnread(bg)).toBe(true);
    expect(chatStore.unreadWorkspaces()).toContain(bg);
    // The active workspace is never unread to itself.
    chatStore.dispatch(active, { type: 'event', event: userPrompt('self') });
    expect(chatStore.hasUnread(active)).toBe(false);

    // Switching to bg clears its unread (lastSeenRev catches up).
    chatStore.setActive(bg);
    expect(chatStore.hasUnread(bg)).toBe(false);
    expect(chatStore.unreadWorkspaces()).not.toContain(bg);
  });

  it('caches unreadWorkspaces by reference until it actually changes', () => {
    const a = ws();
    chatStore.setActive(ws());
    chatStore.dispatch(a, { type: 'event', event: userPrompt('x') });
    const first = chatStore.unreadWorkspaces();
    const second = chatStore.unreadWorkspaces();
    expect(second).toBe(first); // unreadDirty cleared → same array reference
  });
});

describe('chatStore setters bump rev only on change', () => {
  it('setModel/setAutoApprove/setCompacting are no-ops when unchanged', () => {
    const id = ws();
    let ticks = 0;
    const unsub = chatStore.subscribe(() => {
      ticks += 1;
    });
    try {
      chatStore.setModel(id, 'gpt');
      expect(ticks).toBe(1);
      chatStore.setModel(id, 'gpt'); // unchanged → no emit
      expect(ticks).toBe(1);
      expect(chatStore.getModel(id)).toBe('gpt');

      chatStore.setAutoApprove(id, true);
      expect(ticks).toBe(2);
      chatStore.setAutoApprove(id, true);
      expect(ticks).toBe(2);
      expect(chatStore.getAutoApprove(id)).toBe(true);

      chatStore.setCompacting(id, true);
      expect(ticks).toBe(3);
      chatStore.setCompacting(id, true);
      expect(ticks).toBe(3);
    } finally {
      unsub();
    }
  });
});

describe('chatStore snapshot caching', () => {
  it('reuses the cached snapshot object when rev/hasOlder are unchanged', () => {
    const id = ws();
    chatStore.dispatch(id, { type: 'event', event: userPrompt('hi') });
    const s1 = chatStore.getChat(id);
    const s2 = chatStore.getChat(id);
    expect(s2).toBe(s1); // identity preserved → useSyncExternalStore stays stable
  });

  it('preserves the events array reference across a streaming-only tick', () => {
    const id = ws();
    chatStore.dispatch(id, { type: 'event', event: userPrompt('hi') });
    const before = chatStore.getChat(id);
    // assistant_chunk bumps rev but does not touch the committed log.
    chatStore.dispatch(id, { type: 'event', event: evt('assistant_chunk', { delta: 'x' }) });
    const after = chatStore.getChat(id);
    expect(after).not.toBe(before); // rev changed → new snapshot
    expect(after.events).toBe(before.events); // but the committed events array is reused
    expect(after.streamingText).toBe('x');
  });
});

describe('chatStore provider_response side-channel', () => {
  it('folds usage without committing the event to the log', () => {
    const id = ws();
    chatStore.dispatch(id, {
      type: 'event',
      event: providerResponse({ inputTokens: 100, outputTokens: 20 }),
    });
    expect(chatStore.getChat(id).events).toHaveLength(0); // not rendered/persisted
    const usage = chatStore.getUsage(id);
    expect(usage.calls).toBe(1);
    expect(usage.totalInput).toBe(100);
    expect(usage.latestPrompt).toBe(100);
  });

  it('does not emit for a usage-less provider_response', () => {
    const id = ws();
    let ticks = 0;
    const unsub = chatStore.subscribe(() => {
      ticks += 1;
    });
    try {
      chatStore.dispatch(id, { type: 'event', event: providerResponse({}) });
      expect(ticks).toBe(0);
      expect(chatStore.getUsage(id).calls).toBe(0);
    } finally {
      unsub();
    }
  });
});

describe('chatStore compaction side-channel', () => {
  it('reduces latestPrompt by tokensSaved and appends a notice extension', () => {
    const id = ws();
    chatStore.dispatch(id, {
      type: 'event',
      event: providerResponse({ inputTokens: 1000 }),
    });
    expect(chatStore.getUsage(id).latestPrompt).toBe(1000);

    chatStore.dispatch(id, { type: 'event', event: compaction(300) });
    expect(chatStore.getUsage(id).latestPrompt).toBe(700);
    const snap = chatStore.getChat(id);
    expect(snap.extensions).toHaveLength(1);
    expect(snap.extensions[0]!.kind).toBe('notice');
    expect(snap.extensions[0]!.text).toContain('Context compacted');
  });

  it('ignores a zero-tokensSaved compaction', () => {
    const id = ws();
    let ticks = 0;
    const unsub = chatStore.subscribe(() => {
      ticks += 1;
    });
    try {
      chatStore.dispatch(id, { type: 'event', event: compaction(0) });
      expect(ticks).toBe(0);
      expect(chatStore.getChat(id).extensions).toHaveLength(0);
    } finally {
      unsub();
    }
  });
});

describe('chatStore clear/drop', () => {
  it('clear resets the transcript and usage but keeps the workspace', () => {
    const id = ws();
    chatStore.dispatch(id, { type: 'event', event: userPrompt('one') });
    chatStore.dispatch(id, { type: 'event', event: assistant('two') });
    chatStore.dispatch(id, { type: 'event', event: providerResponse({ inputTokens: 5 }) });
    expect(chatStore.getChat(id).events.length).toBeGreaterThan(0);

    chatStore.clear(id);
    const snap = chatStore.getChat(id);
    expect(snap.events).toHaveLength(0);
    expect(snap.isEmpty).toBe(true);
    expect(chatStore.getUsage(id).calls).toBe(0);
  });

  it('drop removes the workspace entirely', () => {
    const id = ws();
    chatStore.dispatch(id, { type: 'event', event: userPrompt('gone') });
    chatStore.drop(id);
    expect(chatStore.getChat(id)).toMatchObject({ isEmpty: true });
  });
});

describe('chatStore initial history loading', () => {
  it('treats an unseen workspace as loading until its initial history read completes', async () => {
    const workspaceId = ws();
    const persisted = userPrompt('loaded after switch');
    let resolveLoad:
      | ((value: { events: ReadonlyArray<MoxxyEvent>; prevCursor: number | null }) => void)
      | null = null;
    const persistence: ChatPersistence = {
      loadSegment() {
        return new Promise((resolve) => {
          resolveLoad = resolve;
        });
      },
      async append() {},
      async clear() {},
    };
    chatStore.setPersistence(persistence);

    expect(chatStore.getChat(workspaceId).loading).toBe(true);

    const loading = chatStore.loadInitial(workspaceId);
    expect(chatStore.getChat(workspaceId).loading).toBe(true);

    resolveLoad?.({ events: [persisted], prevCursor: null });
    await loading;

    expect(chatStore.getChat(workspaceId).loading).toBe(false);
    expect(chatStore.getChat(workspaceId).events).toEqual([persisted]);
  });

  it('dedupes duplicate event ids inside an initial history page', async () => {
    const workspaceId = ws();
    const persisted = userPrompt('loaded once');
    const persistence: ChatPersistence = {
      async loadSegment() {
        return { events: [persisted, { ...persisted } as MoxxyEvent], prevCursor: null };
      },
      async append() {},
      async clear() {},
    };
    chatStore.setPersistence(persistence);

    await chatStore.loadInitial(workspaceId);

    expect(chatStore.getChat(workspaceId).events).toEqual([persisted]);
  });

  it('retries initial history loading when the first fallback page was empty', async () => {
    const workspaceId = ws();
    const persisted = userPrompt('stored history');
    let calls = 0;
    const persistence: ChatPersistence = {
      async loadHistory() {
        return null;
      },
      async loadSegment() {
        calls += 1;
        return calls === 1
          ? { events: [], prevCursor: null }
          : { events: [persisted], prevCursor: null };
      },
      async append() {},
      async clear() {},
    };
    chatStore.setPersistence(persistence);

    await chatStore.loadInitial(workspaceId);
    expect(chatStore.getChat(workspaceId).events).toEqual([]);

    await chatStore.loadInitial(workspaceId);

    expect(chatStore.getChat(workspaceId).events).toEqual([persisted]);
  });
});
