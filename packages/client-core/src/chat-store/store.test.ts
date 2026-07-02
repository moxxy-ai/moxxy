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

  it('mints unique ids across a shift — no collision drops the wrong twin', () => {
    const id = ws();
    // Burst of enqueues with no intervening event (rev/length-derived ids would
    // repeat after the shift below). The id must survive a shiftQueue.
    chatStore.enqueue(id, 'a');
    chatStore.enqueue(id, 'b');
    chatStore.shiftQueue(id); // removes 'a'; queue.length now 1, rev unchanged
    const survivor = chatStore.getQueue(id)[0]!;
    const fresh = chatStore.enqueue(id, 'c');
    // The freshly-minted id must NOT collide with the surviving item's id.
    expect(fresh).not.toBe(survivor.id);
    // Dropping the fresh one leaves the survivor intact (no twin-drop).
    chatStore.dropFromQueue(id, fresh);
    expect(chatStore.getQueue(id).map((q) => q.prompt)).toEqual(['b']);
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

  it('isHidden reports a turn hidden ONLY until its turn_complete clears it', () => {
    chatStore.hideTurn('bg-2');
    expect(chatStore.isHidden('bg-2')).toBe(true);
    expect(chatStore.isHidden('never-hidden')).toBe(false);
    // dispatch of the hidden turn_complete clears the flag (the queue drainer in
    // the bridge captures isHidden() BEFORE this dispatch for exactly that reason).
    chatStore.dispatch(ws(), { type: 'turn_complete', turnId: 'bg-2', error: null });
    expect(chatStore.isHidden('bg-2')).toBe(false);
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

describe('chatStore history loading', () => {
  /** Page an ASCENDING raw log newest-first by `seq` — the same semantics as
   *  @moxxy/core's pageEvents / the runner's session.loadHistory (mirrors the
   *  proven helper in history-equivalence.test.ts): the page itself stays
   *  ascending-within-page; the cursor walks from the newest end backward. */
  function pagerFor(
    rawAscending: ReadonlyArray<MoxxyEvent>,
  ): { persistence: ChatPersistence; calls: () => number } {
    let calls = 0;
    const persistence: ChatPersistence = {
      async loadHistory(_ws, before, limit) {
        calls += 1;
        let end = rawAscending.length;
        if (before !== null) {
          end = 0;
          for (let i = 0; i < rawAscending.length; i += 1) {
            if (rawAscending[i]!.seq < before) end = i + 1;
            else break;
          }
        }
        const start = Math.max(0, end - limit);
        const page = rawAscending.slice(start, end);
        return { events: page, prevCursor: start <= 0 ? null : page[0]!.seq };
      },
    };
    return { persistence, calls: () => calls };
  }

  it('loadInitial leaves loaded=false (retryable) when no runner is connected', async () => {
    const id = ws();
    chatStore.setPersistence({
      async loadHistory() {
        return null; // no connected runner
      },
    });
    await chatStore.loadInitial(id);
    // A second open must re-attempt — the backfill was never run.
    let retried = false;
    chatStore.setPersistence({
      async loadHistory() {
        retried = true;
        return { events: [userPrompt('late')], prevCursor: null };
      },
    });
    await chatStore.loadInitial(id);
    expect(retried).toBe(true);
    expect(chatStore.getChat(id).events).toHaveLength(1);
  });

  it('refreshes latest history and clears a stale active turn when completion was missed', async () => {
    const id = ws();
    const turnId = 'missed-complete-turn';
    const prompt = userPrompt('search the web', turnId);
    const toolRequest = evt('tool_call_requested', {
      turnId,
      callId: 'call-1',
      name: 'web_fetch',
      input: { url: 'https://example.com' },
    });
    const toolResult = evt('tool_result', {
      turnId,
      callId: 'call-1',
      ok: true,
      output: 'result',
    });
    const finalAnswer = assistant('Found the answer.', turnId);

    chatStore.setPersistence(pagerFor([prompt, toolRequest, toolResult, finalAnswer]).persistence);
    chatStore.dispatch(id, { type: 'send_started', turnId });
    chatStore.dispatch(id, { type: 'event', event: prompt });
    chatStore.dispatch(id, { type: 'event', event: toolRequest });
    chatStore.dispatch(id, { type: 'event', event: toolResult });

    expect(chatStore.getChat(id)).toMatchObject({
      sending: true,
      activeTurnId: turnId,
    });

    await chatStore.refreshLatest(id);

    const snap = chatStore.getChat(id);
    expect(snap.events.map((event) => event.id)).toContain(finalAnswer.id);
    expect(snap.sending).toBe(false);
    expect(snap.activeTurnId).toBeNull();
  });

  it('does not clear an active turn when latest recovered history is still mid-tool loop', async () => {
    const id = ws();
    const turnId = 'still-running-turn';
    const prompt = userPrompt('search the web', turnId);
    const interimText = evt('assistant_message', {
      turnId,
      content: 'I will look that up.',
      stopReason: 'tool_use',
    });
    const toolRequest = evt('tool_call_requested', {
      turnId,
      callId: 'call-running',
      name: 'web_fetch',
      input: { url: 'https://example.com' },
    });

    chatStore.setPersistence(pagerFor([prompt, interimText, toolRequest]).persistence);
    chatStore.dispatch(id, { type: 'send_started', turnId });
    chatStore.dispatch(id, { type: 'event', event: prompt });

    await chatStore.refreshLatest(id);

    expect(chatStore.getChat(id)).toMatchObject({
      sending: true,
      activeTurnId: turnId,
    });
  });

  it('does not treat a tool-use assistant message as a terminal turn', async () => {
    const id = ws();
    const turnId = 'tool-use-message-turn';
    const prompt = userPrompt('search the web', turnId);
    const interimText = evt('assistant_message', {
      turnId,
      content: 'I will look that up.',
      stopReason: 'tool_use',
    });

    chatStore.setPersistence(pagerFor([prompt, interimText]).persistence);
    chatStore.dispatch(id, { type: 'send_started', turnId });
    chatStore.dispatch(id, { type: 'event', event: prompt });

    await chatStore.refreshLatest(id);

    expect(chatStore.getChat(id)).toMatchObject({
      sending: true,
      activeTurnId: turnId,
    });
  });

  it('walks raw pages bounded, stopping once enough rendered rows are gathered', async () => {
    const id = ws();
    // An ascending raw log: 600 events, every other one rendered, so a single
    // 200-event page already yields ~100 rendered rows — well past INITIAL_WINDOW
    // (50). The walk MUST stop after the first page, not fan out across the log.
    const pool: MoxxyEvent[] = [];
    for (let i = 0; i < 600; i += 1) {
      pool.push(
        i % 2 === 0
          ? evt('user_prompt', { text: `m${i}`, seq: i, turnId: `t${i}` })
          : evt('provider_request', { provider: 'p', seq: i, turnId: `t${i}` }),
      );
    }
    const { persistence, calls } = pagerFor(pool);
    chatStore.setPersistence(persistence);
    await chatStore.loadInitial(id);
    const events = chatStore.getChat(id).events;
    expect(events.length).toBeGreaterThanOrEqual(50);
    // Every rendered row in the projected window is a real rendered event (no
    // bookkeeping leaked through the projection).
    expect(events.every((e) => e.type === 'user_prompt')).toBe(true);
    // Bounded: a single page held enough rendered rows → exactly one fetch.
    expect(calls()).toBe(1);
  });

  it('never re-fetches more than MAX pages even when rendered rows are sparse', async () => {
    const id = ws();
    // A log where rendered rows are RARE (1 per 250 events) so each 200-event
    // page yields <1 rendered row — the walk is bounded by MAX_RUNNER_PAGES (25)
    // rather than spinning forever.
    const pool: MoxxyEvent[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      pool.push(
        i % 250 === 0
          ? evt('user_prompt', { text: `m${i}`, seq: i, turnId: `t${i}` })
          : evt('provider_request', { provider: 'p', seq: i, turnId: `t${i}` }),
      );
    }
    const { persistence, calls } = pagerFor(pool);
    chatStore.setPersistence(persistence);
    await chatStore.loadInitial(id);
    // Bounded by MAX_RUNNER_PAGES (25) — the load returns rather than hanging.
    expect(calls()).toBeLessThanOrEqual(25);
  });
});
