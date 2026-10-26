/**
 * EventBlockView routing for ambient-trigger prompts: a `user_prompt` carrying
 * an `origin` renders the compact, expandable trigger marker (NOT the raw user
 * bubble), keeping the often-large untrusted payload collapsed until clicked.
 * An ordinary user prompt still renders the user bubble.
 */

import { describe, expect, it } from 'vitest';
import { onAgentWorkFocus } from '@moxxy/client-core';
import { AgentWorkLinkProvider } from '../agent-work-link';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { asPluginId, assertDefined } from '@moxxy/sdk';
import { EventBlockView } from './EventBlockView';

function userPrompt(extra: Partial<MoxxyEvent>): MoxxyEvent {
  return {
    type: 'user_prompt',
    id: 'e1' as MoxxyEvent['id'],
    seq: 1,
    ts: 0,
    sessionId: 's1' as MoxxyEvent['sessionId'],
    turnId: 't1' as MoxxyEvent['turnId'],
    source: 'user',
    text: 'PAYLOAD-BODY-12345',
    ...extra,
  } as MoxxyEvent;
}

describe('EventBlockView — a turn the agent took up after its background work', () => {
  const continued = userPrompt({
    text: 'List files finished in the background',
    origin: { kind: 'agent', name: 'List files finished in the background', workId: 'toolu_1' },
  });

  it('opens that work in the Agents pane instead of repeating its name in a box', () => {
    const opened: string[] = [];
    const off = onAgentWorkFocus((workspaceId) => opened.push(workspaceId));
    render(
      <AgentWorkLinkProvider workspaceId="ws">
        <EventBlockView event={continued} />
      </AgentWorkLinkProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Agent continued/ }));

    expect(opened).toEqual(['ws']);
    expect(screen.getAllByText(/List files finished in the background/)).toHaveLength(1);
    expect(screen.getByTestId('block-trigger')).toHaveAttribute('data-event-id', 'e1');
    off();
  });

  it('shows nothing to expand when it names no work', () => {
    render(<EventBlockView event={userPrompt({ text: 'Claude went on', origin: { kind: 'agent', name: 'Claude went on' } })} />);

    expect(screen.getByTestId('block-trigger').querySelector('button')).toBeNull();
    expect(screen.getAllByText(/Claude went on/)).toHaveLength(1);
  });

  it('keeps a long work name to one line and gives the whole of it on hover', () => {
    const command = `cd "/Users/me/project" && ${'gh pr view 675 --json body && '.repeat(12)}echo done finished in the background`;
    render(<EventBlockView event={userPrompt({ text: command, origin: { kind: 'agent', name: command } })} />);

    const name = screen.getByText(command);
    // One line: the chip is a pill, so a wrapped name turns it into an oval.
    expect(name).toHaveClass('trigger__name');
    expect(name).toHaveAttribute('title', command);
  });
});

describe('EventBlockView — ambient trigger marker', () => {
  it('renders a collapsed trigger marker for a webhook-origin prompt', () => {
    render(<EventBlockView event={userPrompt({ origin: { kind: 'webhook', name: 'github-issues' } })} />);
    expect(screen.getByTestId('block-trigger')).toBeTruthy();
    expect(screen.queryByTestId('block-user')).toBeNull();
    // The raw payload is hidden until expanded.
    expect(screen.queryByText(/PAYLOAD-BODY-12345/)).toBeNull();
    expect(screen.getByText(/github-issues/)).toBeTruthy();
  });

  it('reveals the full prompt when the marker is expanded', () => {
    render(<EventBlockView event={userPrompt({ origin: { kind: 'schedule', name: 'daily' } })} />);
    const triggerButton = screen.getByTestId('block-trigger').querySelector('button');
    assertDefined(triggerButton, 'trigger expand button');
    fireEvent.click(triggerButton);
    expect(screen.getByText(/PAYLOAD-BODY-12345/)).toBeTruthy();
  });

  it('folds voice conversation held during a task into one collapsed block', () => {
    render(<EventBlockView event={userPrompt({ origin: { kind: 'voice', name: '3 exchanges while the agent worked' } })} />);
    expect(screen.getByTestId('block-trigger')).toBeTruthy();
    expect(screen.queryByTestId('block-user')).toBeNull();
    expect(screen.getByText(/Voice conversation/)).toBeTruthy();
    expect(screen.getByText(/3 exchanges while the agent worked/)).toBeTruthy();
    expect(screen.queryByText(/PAYLOAD-BODY-12345/)).toBeNull();
  });

  it('renders a neutral marker (instead of crashing the app) for an origin kind this build does not know', () => {
    // History written by another build can carry a kind outside today's union.
    const origin = { kind: 'telepathy', name: 'from-the-future' } as unknown as { kind: 'webhook'; name: string };
    render(<EventBlockView event={userPrompt({ origin })} />);
    expect(screen.getByTestId('block-trigger')).toBeTruthy();
    expect(screen.getByText(/Telepathy trigger/)).toBeTruthy();
    expect(screen.getByText(/from-the-future/)).toBeTruthy();
  });

  it('renders an ordinary user bubble when there is no origin', () => {
    render(<EventBlockView event={userPrompt({})} />);
    expect(screen.getByTestId('block-user')).toBeTruthy();
    expect(screen.queryByTestId('block-trigger')).toBeNull();
  });
});

describe('EventBlockView — a question closed without an answer', () => {
  it.each([
    ['agent-went-on', 'Question closed: the agent went on without an answer.'],
    ['new-message', 'Question closed: you sent a new message instead.'],
  ])('keeps the reason %s in the transcript', (note, text) => {
    const event: MoxxyEvent = {
      type: 'plugin_event',
      id: 'closed-question' as MoxxyEvent['id'],
      sessionId: 's1' as MoxxyEvent['sessionId'],
      turnId: 't1' as MoxxyEvent['turnId'],
      seq: 3,
      ts: 0,
      source: 'system',
      pluginId: asPluginId('@moxxy/question'),
      subtype: 'question_resolved',
      payload: { questionId: 'q1', dismissed: 'cancelled', note },
    };

    render(<EventBlockView event={event} />);

    expect(screen.getByRole('status').textContent).toBe(text);
  });
});

describe("EventBlockView — an agent's account limit", () => {
  const limitEvent = (limit: Record<string, unknown>): MoxxyEvent =>
    ({
      type: 'plugin_event',
      id: 'e2' as MoxxyEvent['id'],
      seq: 2,
      ts: new Date(2026, 9, 12, 14, 0).getTime(),
      sessionId: 's1' as MoxxyEvent['sessionId'],
      turnId: 't1' as MoxxyEvent['turnId'],
      source: 'system',
      pluginId: '@moxxy/agent-connection',
      subtype: 'account_limit',
      payload: { provider: 'claude-code', agent: 'Claude', limit },
    }) as unknown as MoxxyEvent;

  it('says in the conversation that the limit is used up and when it resets, in place of the raw error', () => {
    render(<EventBlockView event={limitEvent({ state: 'reached', windowMinutes: 300, resetsAt: new Date(2026, 9, 12, 18, 0).getTime() })} />);
    expect(screen.getByRole('alert').textContent).toBe("Claude's 5-hour limit is used up · resets at 18:00");
  });

  it('leaves a limit with room left to the bar above the message box', () => {
    const { container } = render(<EventBlockView event={limitEvent({ state: 'near', usedPercent: 92 })} />);
    expect(container.textContent).toBe('');
  });
});

describe('EventBlockView — a turn the agent took up by itself and finished without replying', () => {
  it('says so where the turn ended', () => {
    const noReply = {
      type: 'plugin_event',
      id: 'e3' as MoxxyEvent['id'],
      seq: 3,
      ts: 0,
      sessionId: 's1' as MoxxyEvent['sessionId'],
      turnId: 't1' as MoxxyEvent['turnId'],
      source: 'system',
      pluginId: '@moxxy/agent-connection',
      subtype: 'no_reply',
      payload: {},
    } as MoxxyEvent;
    render(<EventBlockView event={noReply} />);
    expect(screen.getByTestId('block-system').textContent).toBe('The agent finished without replying.');
  });
});
