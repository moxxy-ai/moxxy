import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRenderNodes } from '@moxxy/client-core';
import type { SubagentBlock, SubagentGroupBlock } from '@moxxy/chat-model';
import type { MoxxyEvent } from '@moxxy/sdk';
import { EventBlockView } from '../blocks/EventBlockView';
import { SubagentGroupView } from '../blocks/SubagentGroupView';
import { visibleTranscriptNodes } from '../transcript-nodes';
import { ModeOutcomeCard } from './ModeOutcomeCard';
import { ModeTranscriptContext } from './ModeTranscriptContext';
import { readModeEvents } from './mode-events';

/**
 * A plan, a goal run and a research run are drawn with the same care as an
 * ordinary answer: what closes the mode's work is a headed card, the steps in
 * between are quiet lines, and the agents of a research round are a list of
 * the questions they are answering.
 */

afterEach(cleanup);

let seq = 0;
function ev(type: string, extra: Record<string, unknown>): MoxxyEvent {
  seq += 1;
  return { type, id: `e${seq}`, seq, ts: seq, sessionId: 's', turnId: 't1', ...extra } as unknown as MoxxyEvent;
}
const plugin = (pluginId: string, subtype: string, payload: unknown): MoxxyEvent =>
  ev('plugin_event', { pluginId, subtype, payload, source: 'plugin' });

function renderWith(events: ReadonlyArray<MoxxyEvent>, shown: MoxxyEvent): HTMLElement {
  return render(
    <ModeTranscriptContext.Provider value={readModeEvents(events)}>
      <EventBlockView event={shown} />
    </ModeTranscriptContext.Provider>,
  ).container;
}

describe('ModeOutcomeCard', () => {
  it('heads the message with what happened and the facts of it', () => {
    render(
      <ModeOutcomeCard
        outcome={{ kind: 'plan', title: 'Plan', tone: 'neutral', facts: [{ text: '3 steps' }, { text: '1 decision needed', tone: 'warn' }] }}
        text={'# Move it\n\nBody of the plan.'}
      />,
    );
    const card = screen.getByTestId('mode-outcome');
    expect(card).toHaveAttribute('data-kind', 'plan');
    expect(card).toHaveAttribute('data-tone', 'neutral');
    expect(screen.getByText('Plan')).toHaveClass('outcome__title');
    expect(screen.getByText('3 steps')).toHaveClass('tag');
    expect(screen.getByText('1 decision needed')).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByRole('heading', { name: 'Move it' })).toBeInTheDocument();
  });

  it('is a card of its own, not the agent’s bubble', () => {
    render(<ModeOutcomeCard outcome={{ kind: 'goal-complete', title: 'Goal complete', tone: 'good', facts: [] }} text="Done." />);
    const card = screen.getByTestId('mode-outcome');
    expect(card).not.toHaveClass('bubble');
    expect(card).not.toHaveAttribute('style');
  });

  it('does not say twice what its heading says', () => {
    render(
      <ModeOutcomeCard
        outcome={{ kind: 'goal-complete', title: 'Goal complete', tone: 'good', facts: [] }}
        text="✓ Goal complete — the suite passes"
      />,
    );
    expect(screen.getByTestId('mode-outcome').textContent).toBe('Goal completeThe suite passes');
  });
});

describe('EventBlockView in a mode', () => {
  it('draws the message that closes a mode as a card', () => {
    const done = plugin('@moxxy/mode-goal', 'goal_completed', { summary: 'ok', evidenceCount: 0, iterations: 2 });
    const message = ev('assistant_message', { content: '✓ Goal complete — ok', stopReason: 'end_turn', source: 'system' });
    renderWith([done, message], message);
    expect(screen.getByTestId('mode-outcome')).toHaveAttribute('data-kind', 'goal-complete');
    expect(screen.queryByTestId('block-assistant')).toBeNull();
  });

  it('leaves every other message the bubble it was', () => {
    const message = ev('assistant_message', { content: 'Hello.', stopReason: 'end_turn', source: 'model' });
    renderWith([message], message);
    expect(screen.getByTestId('block-assistant')).toBeInTheDocument();
    expect(screen.queryByTestId('mode-outcome')).toBeNull();
  });

  it('draws a step of the run as a quiet line', () => {
    const round = plugin('@moxxy/mode-deep-research', 'deep_research_fanout_started', { round: 1, queries: 3 });
    renderWith([round], round);
    const note = screen.getByTestId('mode-note');
    expect(note).toHaveTextContent('Round 1. Researching 3 questions.');
    expect(note).toHaveAttribute('data-tone', 'info');
  });

  it('draws nothing for an event that is only bookkeeping', () => {
    const quiet = plugin('@moxxy/mode-deep-research', 'deep_research_followups_planning', { round: 2, basedOn: 3 });
    expect(renderWith([quiet], quiet)).toBeEmptyDOMElement();
  });
});

describe('visibleTranscriptNodes in a mode', () => {
  it('keeps a row for a step that has a line, and none for bookkeeping', () => {
    const prompt = ev('user_prompt', { text: 'Research it.', source: 'user' });
    const round = plugin('@moxxy/mode-deep-research', 'deep_research_fanout_started', { round: 1, queries: 2 });
    const quiet = plugin('@moxxy/mode-deep-research', 'deep_research_followups_planning', { round: 2, basedOn: 2 });
    const events = [prompt, round, quiet];
    const ids = visibleTranscriptNodes(buildRenderNodes(events, []), readModeEvents(events).notes).map((node) =>
      node.kind === 'block' ? node.block.id : 'other',
    );
    expect(ids).toEqual([prompt.id, round.id]);
  });
});

describe('visibleTranscriptNodes and the tools a mode signals with', () => {
  const call = (callId: string, name: string): MoxxyEvent =>
    ev('tool_call_requested', { callId, name, input: { summary: 'done' }, source: 'model' });
  const result = (callId: string, ok: boolean): MoxxyEvent =>
    ev('tool_result', { callId, ok, output: ok ? { acknowledged: true } : 'invalid input', source: 'tool' });
  const names = (events: MoxxyEvent[]): string[] =>
    visibleTranscriptNodes(buildRenderNodes(events, [])).flatMap((node) =>
      node.kind === 'block' && node.block.kind === 'tool-call' ? [node.block.request.name] : [],
    );

  it('draws no row for the call that only says the plan or the goal is done', () => {
    // What it said is the card that follows; the row would say it twice, as JSON.
    expect(
      names([
        call('c1', 'Bash'),
        result('c1', true),
        call('c2', 'goal_complete'),
        result('c2', true),
        call('c3', 'plan_complete'),
        result('c3', true),
        call('c4', 'goal_abandon'),
      ]),
    ).toEqual(['Bash']);
  });

  it('keeps the row when the signal was refused, since nothing else will say so', () => {
    expect(names([call('c1', 'plan_complete'), result('c1', false)])).toEqual(['plan_complete']);
  });
});

function agent(n: number, patch: Partial<SubagentBlock> = {}): SubagentBlock {
  return {
    kind: 'subagent',
    id: `a${n}`,
    childSessionId: `c${n}`,
    label: `subagent-${n}`,
    agentType: 'default',
    startedAtMs: 0,
    completedAtMs: 1000,
    toolCallCount: 6,
    tokensUsed: 41200,
    toolCalls: [],
    stopReason: 'end_turn',
    finalPreview: 'An answer.',
    error: null,
    ...patch,
  };
}
const group = (agents: SubagentBlock[], agentType = 'default'): SubagentGroupBlock => ({
  kind: 'subagent-group',
  id: 'g1',
  agentType,
  agents,
});

describe('SubagentGroupView', () => {
  it('counts the agents in plain words, without the name of the default kind', () => {
    const { rerender } = render(
      <SubagentGroupView block={group([agent(1), agent(2), agent(3, { error: 'timed out' })])} />,
    );
    expect(screen.getByRole('button', { name: /3 agents finished, 1 failed/ })).toBeInTheDocument();
    rerender(<SubagentGroupView block={group([agent(1, { completedAtMs: null })], 'Explore')} />);
    expect(screen.getByRole('button', { name: /1 Explore agent running/ })).toBeInTheDocument();
  });

  it('lists the agents as rows of the conversation, not as a terminal tree', () => {
    const { container } = render(<SubagentGroupView block={group([agent(1), agent(2, { error: 'timed out' })])} />);
    fireEvent.click(screen.getByRole('button', { name: /2 agents/ }));
    const rows = container.querySelectorAll('.agent-row');
    expect(rows).toHaveLength(2);
    expect(container.textContent).not.toMatch(/[├│└]/);
    expect(container.querySelector('.mono')).toBeNull();
    for (const row of rows) expect(row.querySelector('[style]')).toBeNull();
    expect(rows[0]?.querySelector('.agent-row__meta')).toHaveTextContent('6 tool uses · 41.2k tokens');
    expect(rows[1]?.querySelector('.agent-row__state')).toHaveTextContent('Failed');
    expect(rows[1]).toHaveTextContent('timed out');
  });

  it('names a research agent by the question it is answering', () => {
    const titles = new Map([['c1', 'What does the documentation say about WAL mode?']]);
    render(
      <ModeTranscriptContext.Provider value={{ outcomes: new Map(), notes: new Map(), agentTitles: titles, openPlanId: null }}>
        <SubagentGroupView block={group([agent(1), agent(2)])} />
      </ModeTranscriptContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /2 agents/ }));
    expect(screen.getByText('What does the documentation say about WAL mode?')).toHaveClass('agent-row__name');
    expect(screen.getByText('subagent-2')).toHaveClass('agent-row__name');
  });
});
