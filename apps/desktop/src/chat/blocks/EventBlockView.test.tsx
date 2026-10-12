/**
 * EventBlockView routing for ambient-trigger prompts: a `user_prompt` carrying
 * an `origin` renders the compact, expandable trigger marker (NOT the raw user
 * bubble), keeping the often-large untrusted payload collapsed until clicked.
 * An ordinary user prompt still renders the user bubble.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { assertDefined } from '@moxxy/sdk';
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
