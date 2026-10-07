import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { outcomeBody, readModeEvents } from './mode-events';

/**
 * What the plan, goal and research modes say about a turn besides its
 * messages. They report it as plugin events; this reads them into what the
 * conversation draws: a heading for the message that closes a mode's work, a
 * line for a step in between, and a name for each research agent.
 */

let seq = 0;
function ev(type: string, turnId: string, extra: Record<string, unknown>): MoxxyEvent {
  seq += 1;
  return { type, id: `e${seq}`, seq, ts: seq, sessionId: 's', turnId, ...extra } as unknown as MoxxyEvent;
}
const plugin = (turnId: string, pluginId: string, subtype: string, payload: unknown): MoxxyEvent =>
  ev('plugin_event', turnId, { pluginId, subtype, payload, source: 'plugin' });
const said = (turnId: string, content: string): MoxxyEvent =>
  ev('assistant_message', turnId, { content, stopReason: 'end_turn', source: 'system' });

const PLAN = '@moxxy/mode-plan';
const GOAL = '@moxxy/mode-goal';
const RESEARCH = '@moxxy/mode-deep-research';
const SUBAGENTS = '@moxxy/subagents';

describe('readModeEvents — the message that closes a mode', () => {
  it('heads a finished plan with what it holds', () => {
    const message = said('t1', '# Move it\n\n…');
    const read = readModeEvents([
      plugin('t1', PLAN, 'plan_completed', { title: 'Move it', steps: 3, recommendedMode: 'default', questions: 1 }),
      message,
    ]);
    expect(read.outcomes.get(message.id)).toEqual({
      kind: 'plan',
      title: 'Plan',
      tone: 'neutral',
      facts: [{ text: '3 steps' }, { text: '1 decision needed', tone: 'warn' }, { text: 'Suggests Default mode' }],
    });
  });

  it('says nothing of decisions when a plan leaves none open', () => {
    const message = said('t1', '# Move it');
    const read = readModeEvents([
      plugin('t1', PLAN, 'plan_completed', { title: 'Move it', steps: 1, recommendedMode: 'goal', questions: 0 }),
      message,
    ]);
    expect(read.outcomes.get(message.id)?.facts).toEqual([{ text: '1 step' }, { text: 'Suggests Goal mode' }]);
  });

  it('heads the three ways a goal run ends', () => {
    const done = said('t1', '✓ Goal complete — it passes');
    const paused = said('t2', 'Goal abandoned — no token');
    const ended = said('t3', 'Goal run ended: the model stopped working');
    const read = readModeEvents([
      plugin('t1', GOAL, 'goal_completed', { summary: 'it passes', evidenceCount: 2, iterations: 4 }),
      done,
      plugin('t2', GOAL, 'goal_abandoned', { reason: 'no token', iterations: 2 }),
      paused,
      plugin('t3', GOAL, 'goal_stalled', { idleIterations: 3, iterations: 9 }),
      ended,
    ]);
    expect(read.outcomes.get(done.id)).toMatchObject({ kind: 'goal-complete', title: 'Goal complete', tone: 'good', facts: [{ text: '4 steps' }] });
    expect(read.outcomes.get(paused.id)).toMatchObject({ kind: 'goal-paused', title: 'Goal paused, it needs you', tone: 'warn' });
    expect(read.outcomes.get(ended.id)).toMatchObject({ kind: 'goal-ended', title: 'Goal run ended', tone: 'neutral' });
  });

  it('heads the research questions, first and follow-up', () => {
    const plan = said('t1', '1. A?\n2. B?');
    const more = said('t1', 'Follow-up round 2 — spawning 1 more subagent:\n1. C?');
    const read = readModeEvents([
      plugin('t1', RESEARCH, 'deep_research_queries_drafted', { text: '1. A?\n2. B?', queries: ['A?', 'B?'], redraft: 0 }),
      plan,
      plugin('t1', RESEARCH, 'deep_research_followups_drafted', { round: 2, proposed: 1, kept: 1, queries: ['C?'] }),
      more,
    ]);
    expect(read.outcomes.get(plan.id)).toMatchObject({ kind: 'research-plan', title: 'Research plan', facts: [{ text: '2 questions' }] });
    expect(read.outcomes.get(more.id)).toMatchObject({ kind: 'research-followup', title: 'Follow-up, round 2', facts: [{ text: '1 question' }] });
  });

  it('heads only the message of the same turn', () => {
    // A research plan the person turned down ends its turn with no message;
    // the next turn's answer is not that plan.
    const later = said('t2', 'Something else entirely.');
    const read = readModeEvents([
      plugin('t1', RESEARCH, 'deep_research_queries_drafted', { text: '1. A?', queries: ['A?'], redraft: 0 }),
      ev('abort', 't1', { reason: 'query plan rejected by user', source: 'user' }),
      ev('user_prompt', 't2', { text: 'never mind', source: 'user' }),
      later,
    ]);
    expect(read.outcomes.size).toBe(0);
  });

  it('heads one message, not every one after it', () => {
    const first = said('t1', '✓ Goal complete — done');
    const second = said('t1', 'A later word.');
    const read = readModeEvents([plugin('t1', GOAL, 'goal_completed', { summary: 'done', evidenceCount: 0, iterations: 1 }), first, second]);
    expect(read.outcomes.has(first.id)).toBe(true);
    expect(read.outcomes.has(second.id)).toBe(false);
  });
});

describe('readModeEvents — a step in between', () => {
  it('notes the steps of a goal run', () => {
    const started = plugin('t1', GOAL, 'goal_started', { autoApprove: true, maxIterations: null });
    const stuck = plugin('t1', GOAL, 'goal_stuck', { tool: 'Bash', count: 3, kind: 'exact' });
    const read = readModeEvents([started, stuck]);
    expect(read.notes.get(started.id)).toEqual({ text: 'Goal run started. Tool calls are approved automatically.', tone: 'info' });
    expect(read.notes.get(stuck.id)).toEqual({ text: 'Bash ran 3 times with the same result. Trying another way.', tone: 'warn' });
  });

  it('notes the rounds of a research run and how it ended', () => {
    const round1 = plugin('t1', RESEARCH, 'deep_research_fanout_started', { round: 1, queries: 3 });
    const round2 = plugin('t1', RESEARCH, 'deep_research_fanout_started', { round: 2, queries: 1 });
    const none = plugin('t1', RESEARCH, 'deep_research_followups_none', { round: 3 });
    const done = plugin('t1', RESEARCH, 'deep_research_synthesis_completed', { totalFindings: 4, rounds: 2, errored: 1 });
    const read = readModeEvents([round1, round2, none, done]);
    expect(read.notes.get(round1.id)).toEqual({ text: 'Round 1. Researching 3 questions.', tone: 'info' });
    expect(read.notes.get(round2.id)).toEqual({ text: 'Round 2. Researching 1 question.', tone: 'info' });
    expect(read.notes.get(none.id)).toEqual({ text: 'No more questions to follow up.', tone: 'info' });
    expect(read.notes.get(done.id)).toEqual({ text: 'Research complete. 4 findings over 2 rounds, 1 failed.', tone: 'good' });
  });

  it('keeps quiet about bookkeeping', () => {
    const read = readModeEvents([
      ev('mode_iteration', 't1', { strategy: 'research', iteration: 0, routing: 'unresolved', source: 'system' }),
      plugin('t1', RESEARCH, 'deep_research_followups_planning', { round: 2, basedOn: 3 }),
      plugin('t1', RESEARCH, 'deep_research_fanout_completed', { round: 1, total: 3, errored: 0 }),
      plugin('t1', 'someone-else', 'goal_started', {}),
    ]);
    expect(read.notes.size).toBe(0);
  });

  it('survives a payload that is not what the mode promised', () => {
    const odd = plugin('t1', RESEARCH, 'deep_research_fanout_started', null);
    const message = said('t1', 'x');
    const read = readModeEvents([odd, plugin('t1', PLAN, 'plan_completed', 'nope'), message]);
    expect(read.notes.get(odd.id)).toEqual({ text: 'Researching.', tone: 'info' });
    expect(read.outcomes.get(message.id)).toMatchObject({ kind: 'plan', facts: [] });
  });
});

describe('readModeEvents — who is researching what', () => {
  const start = (turnId: string, child: string, label: string): MoxxyEvent =>
    plugin(turnId, SUBAGENTS, 'subagent_started', { childSessionId: child, label, agentType: 'default' });

  it('names each research agent by its question', () => {
    const read = readModeEvents([
      plugin('t1', RESEARCH, 'deep_research_queries_drafted', { text: '', queries: ['What is WAL?', 'How is it packaged?'], redraft: 0 }),
      start('t1', 'c1', 'subagent-1'),
      start('t1', 'c2', 'subagent-2'),
      plugin('t1', RESEARCH, 'deep_research_followups_drafted', { round: 2, proposed: 1, kept: 1, queries: ['What breaks mid-write?'] }),
      start('t1', 'c3', 'subagent-1'),
    ]);
    expect(read.agentTitles.get('c1')).toBe('What is WAL?');
    expect(read.agentTitles.get('c2')).toBe('How is it packaged?');
    expect(read.agentTitles.get('c3')).toBe('What breaks mid-write?');
  });

  it('leaves any other agent with the name it was given', () => {
    const read = readModeEvents([
      start('t1', 'c1', 'Explore the repo'),
      plugin('t2', RESEARCH, 'deep_research_queries_drafted', { text: '', queries: ['A?'], redraft: 0 }),
      start('t3', 'c2', 'subagent-1'),
      start('t2', 'c3', 'subagent-9'),
    ]);
    expect(read.agentTitles.size).toBe(0);
  });
});

describe('outcomeBody — the heading has already said it', () => {
  it('drops the words the heading repeats', () => {
    expect(outcomeBody('goal-complete', '✓ Goal complete — the suite passes\n\n- proof')).toBe('The suite passes\n\n- proof');
    expect(outcomeBody('goal-paused', 'Goal abandoned — no token on this machine.')).toBe('No token on this machine.');
    expect(outcomeBody('goal-ended', 'Goal run ended: the model stopped working.')).toBe('The model stopped working.');
    expect(outcomeBody('research-followup', 'Follow-up round 2 — spawning 1 more subagent:\n1. C?')).toBe('1. C?');
  });

  it('leaves a message alone when it does not open the way the mode writes it', () => {
    expect(outcomeBody('goal-complete', 'All done.')).toBe('All done.');
    expect(outcomeBody('plan', '# Move it\n\nBody')).toBe('# Move it\n\nBody');
    expect(outcomeBody('research-plan', '1. A?')).toBe('1. A?');
  });
});
