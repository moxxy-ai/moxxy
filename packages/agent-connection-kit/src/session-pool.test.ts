/**
 * The live agent sessions an agent connection keeps: one per Moxxy
 * conversation, so a follow-up message reaches the agent that is already
 * running instead of starting a new one each turn.
 */
import { describe, expect, it } from 'vitest';
import { AgentSessionPool } from './session-pool.js';

class LiveAgent {
  closed = false;
  constructor(readonly conversation: string) {}
  close(): void {
    this.closed = true;
  }
}

function pool(limit = 2) {
  const started: LiveAgent[] = [];
  const sessions = new AgentSessionPool<LiveAgent>({
    limit,
    create: async (conversation) => {
      const agent = new LiveAgent(conversation);
      started.push(agent);
      return agent;
    },
  });
  return { sessions, started };
}

describe('the live agent sessions', () => {
  it('keeps the agent of a conversation running between turns', async () => {
    const { sessions, started } = pool();

    const first = await sessions.acquire('conv-a');
    first.release();
    const second = await sessions.acquire('conv-a');

    expect(second.session).toBe(first.session);
    expect(started).toHaveLength(1);
  });

  it('closes the agent used longest ago to make room for a new conversation', async () => {
    const { sessions, started } = pool(2);
    (await sessions.acquire('conv-a')).release();
    (await sessions.acquire('conv-b')).release();
    (await sessions.acquire('conv-a')).release();

    (await sessions.acquire('conv-c')).release();

    expect(started.map((a) => [a.conversation, a.closed])).toEqual([
      ['conv-a', false],
      ['conv-b', true],
      ['conv-c', false],
    ]);
    expect(sessions.size).toBe(2);
  });

  it('waits for a turn to finish when every agent is busy, then makes room', async () => {
    const { sessions, started } = pool(1);
    const busy = await sessions.acquire('conv-a');

    let got = false;
    const waiting = sessions.acquire('conv-b').then((lease) => {
      got = true;
      return lease;
    });
    await Promise.resolve();
    expect(got).toBe(false);
    busy.release();

    const lease = await waiting;
    expect(lease.session.conversation).toBe('conv-b');
    expect(started[0]?.closed).toBe(true);
  });

  it('runs one turn at a time per conversation', async () => {
    const { sessions } = pool();
    const first = await sessions.acquire('conv-a');

    let got = false;
    const second = sessions.acquire('conv-a').then(() => (got = true));
    await Promise.resolve();
    expect(got).toBe(false);
    first.release();

    await second;
    expect(got).toBe(true);
  });

  it('stops waiting when the turn is stopped', async () => {
    const { sessions } = pool(1);
    await sessions.acquire('conv-a');
    const controller = new AbortController();

    const waiting = sessions.acquire('conv-b', { signal: controller.signal });
    controller.abort();

    await expect(waiting).rejects.toThrow(/abort/i);
  });

  it('starts a new agent after the old one is thrown away', async () => {
    const { sessions, started } = pool();
    const broken = await sessions.acquire('conv-a');

    await broken.discard();
    const fresh = await sessions.acquire('conv-a');

    expect(started[0]?.closed).toBe(true);
    expect(fresh.session).not.toBe(started[0]);
  });

  it('frees the place when an agent fails to start', async () => {
    let attempts = 0;
    const sessions = new AgentSessionPool<LiveAgent>({
      limit: 1,
      create: async (conversation) => {
        attempts += 1;
        if (attempts === 1) throw new Error('claude is not signed in');
        return new LiveAgent(conversation);
      },
    });

    await expect(sessions.acquire('conv-a')).rejects.toThrow('claude is not signed in');
    const lease = await sessions.acquire('conv-b');

    expect(lease.session.conversation).toBe('conv-b');
  });

  it('starts an agent with the settings of the turn that needs it', async () => {
    const { sessions } = pool();

    const lease = await sessions.acquire('conv-a', { create: async () => new LiveAgent('with-settings') });

    expect(lease.session.conversation).toBe('with-settings');
  });

  it('closes the agent of a conversation that ended, and only that one', async () => {
    const { sessions, started } = pool();
    (await sessions.acquire('conv-a')).release();
    (await sessions.acquire('conv-b')).release();

    await sessions.close('conv-a');

    expect(started.map((a) => [a.conversation, a.closed])).toEqual([
      ['conv-a', true],
      ['conv-b', false],
    ]);
    expect(sessions.size).toBe(1);
  });

  it('closes every agent when Moxxy shuts down, and starts no more', async () => {
    const { sessions, started } = pool();
    (await sessions.acquire('conv-a')).release();
    await sessions.acquire('conv-b');

    await sessions.closeAll();

    expect(started.every((a) => a.closed)).toBe(true);
    await expect(sessions.acquire('conv-c')).rejects.toThrow(/closed/);
  });
});
