/**
 * EventBlockView routing for ambient-trigger prompts: a `user_prompt` carrying
 * an `origin` renders the compact, expandable trigger marker (NOT the raw user
 * bubble), keeping the often-large untrusted payload collapsed until clicked.
 * An ordinary user prompt still renders the user bubble.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MoxxyEvent } from '@moxxy/sdk';
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
    fireEvent.click(screen.getByTestId('block-trigger').querySelector('button')!);
    expect(screen.getByText(/PAYLOAD-BODY-12345/)).toBeTruthy();
  });

  it('renders an ordinary user bubble when there is no origin', () => {
    render(<EventBlockView event={userPrompt({})} />);
    expect(screen.getByTestId('block-user')).toBeTruthy();
    expect(screen.queryByTestId('block-trigger')).toBeNull();
  });
});
