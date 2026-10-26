/** Loading an agent's earlier session: never a silent fresh start. */
import { describe, expect, it } from 'vitest';
import { earlierConversationNote, LOST_SESSION_NOTE, resumeAgentSession } from './resume.js';

const failing = (...errors: unknown[]) => {
  let calls = 0;
  const load = async () => {
    const error = errors[calls++];
    if (error) throw error;
    return 'session';
  };
  return { load, calls: () => calls };
};

describe('resumeAgentSession', () => {
  it('hands back the session the agent loaded', async () => {
    const { load } = failing();

    await expect(resumeAgentSession({ label: 'OpenCode', load, gone: () => false })).resolves.toEqual({ kind: 'loaded', session: 'session' });
  });

  it('says the session is gone when the agent says it no longer exists, without trying again', async () => {
    const attempt = failing(new Error('no rollout found'));

    await expect(resumeAgentSession({ label: 'Codex', load: attempt.load, gone: () => true })).resolves.toEqual({ kind: 'gone' });
    expect(attempt.calls()).toBe(1);
  });

  it('tries once more after a failure that is not a missing session', async () => {
    const attempt = failing(new Error('service failure'));

    await expect(resumeAgentSession({ label: 'OpenCode', load: attempt.load, gone: () => false, retryAfterMs: 1 })).resolves.toEqual({ kind: 'loaded', session: 'session' });
    expect(attempt.calls()).toBe(2);
  });

  it('fails without starting anything in its place when the second try fails too', async () => {
    const attempt = failing(new Error('service failure'), new Error('service failure again'));

    await expect(resumeAgentSession({ label: 'OpenCode', load: attempt.load, gone: () => false, retryAfterMs: 1 })).rejects.toThrow(
      /OpenCode could not load this conversation's earlier session \(service failure again\)\. Moxxy started no other session in its place/,
    );
  });

  it('asks again whether the session is gone after the second try', async () => {
    const attempt = failing(new Error('busy'), new Error('not found'));
    let asked = 0;

    await expect(resumeAgentSession({ label: 'OpenCode', load: attempt.load, gone: async () => ++asked === 2, retryAfterMs: 1 })).resolves.toEqual({ kind: 'gone' });
  });
});

describe('what a new agent session is told first', () => {
  const earlier = '### Turn 1\nPerson: Use port 5433';

  it('hands over the conversation so far after the earlier session was lost', () => {
    const note = earlierConversationNote('lost', earlier) ?? '';

    expect(note).toMatch(/^Your earlier session for this Moxxy conversation no longer exists/);
    expect(note).toContain(earlier);
  });

  it('hands it over to an agent that joins the conversation partway', () => {
    expect(earlierConversationNote('new', earlier)).toMatch(/^You join this Moxxy conversation partway[\s\S]*Use port 5433/);
  });

  it('says only that the session was lost when there is no earlier turn, and nothing to a new conversation', () => {
    expect(earlierConversationNote('lost', undefined)).toBe(LOST_SESSION_NOTE);
    expect(earlierConversationNote('new', undefined)).toBeUndefined();
  });
});
