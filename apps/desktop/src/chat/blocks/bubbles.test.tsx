import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { ThinkingIndicator } from '../ThinkingIndicator';
import { AssistantBlock } from './AssistantBlock';
import { EventBlockView } from './EventBlockView';
import { StreamingReasoning } from './StreamingReasoning';
import { UserBlock } from './UserBlock';

/**
 * The conversation is drawn as a messenger: what the person said is a bubble on
 * their side, what the agent said is a bubble on its side, and everything under
 * a message (its time, its actions) belongs to the entry, not to the bubble.
 */

function event(extra: Record<string, unknown>): MoxxyEvent {
  return {
    id: 'e1',
    seq: 1,
    ts: Date.UTC(2026, 9, 7, 14, 2, 24),
    sessionId: 's1',
    turnId: 't1',
    ...extra,
  } as unknown as MoxxyEvent;
}

describe('UserBlock', () => {
  it('draws the prompt as the person’s bubble', () => {
    render(<UserBlock text="Retry the gateway fault." />);
    const bubble = screen.getByText('Retry the gateway fault.');
    expect(bubble).toHaveClass('bubble', 'bubble--user');
    expect(bubble).not.toHaveAttribute('data-clamped');
  });

  it('marks a clamped prompt on the bubble instead of styling it inline', () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
    render(<UserBlock text={long} />);
    const bubble = screen.getByTestId('block-user').querySelector('.bubble');
    expect(bubble).toHaveAttribute('data-clamped', 'true');
    expect(bubble).not.toHaveAttribute('style');
  });

  it('keeps attachments out of the bubble', () => {
    render(
      <UserBlock
        text="See the log."
        attachments={[{ kind: 'file', name: 'run.log', content: 'boom' }]}
      />,
    );
    const chip = screen.getByText('run.log');
    expect(chip.closest('.bubble')).toBeNull();
    expect(chip.closest('.attachments')).not.toBeNull();
  });

  it('draws no empty bubble for a prompt that is only an attachment', () => {
    render(<UserBlock text="" attachments={[{ kind: 'file', name: 'run.log', content: 'boom' }]} />);
    expect(screen.getByTestId('block-user').querySelector('.bubble')).toBeNull();
  });
});

describe('AssistantBlock', () => {
  it('draws the answer as the agent’s bubble, with no actions inside it', () => {
    render(<AssistantBlock text="All green." streaming={false} />);
    const block = screen.getByTestId('block-assistant');
    expect(block).toHaveClass('bubble', 'bubble--agent');
    expect(block.textContent).toContain('All green.');
    expect(block.querySelector('button')).toBeNull();
  });

  it('says in words why an answer stopped short', () => {
    render(<AssistantBlock text="Half an ans" streaming={false} stopReason="max_tokens" />);
    expect(screen.getByText('Stopped: max tokens')).toBeInTheDocument();
  });

  it('says nothing about an answer that ended normally', () => {
    render(<AssistantBlock text="Done." streaming={false} stopReason="end_turn" />);
    expect(screen.queryByText(/Stopped:/)).toBeNull();
  });
});

describe('EventBlockView as a conversation', () => {
  it('puts a prompt on the person’s side with no kicker over it', () => {
    const { container } = render(
      <EventBlockView event={event({ type: 'user_prompt', text: 'Ship it.', source: 'user' })} />,
    );
    expect(container.querySelector('.tr')).toHaveAttribute('data-role', 'user');
    expect(screen.queryByText(/commanded/i)).toBeNull();
  });

  it('puts the time and the answer’s actions under the answer', () => {
    const { container } = render(
      <EventBlockView
        event={event({ type: 'assistant_message', content: 'Shipped.', stopReason: 'end_turn', source: 'assistant' })}
      />,
    );
    const entry = container.querySelector('.tr');
    expect(entry).toHaveAttribute('data-role', 'agent');
    expect(screen.queryByText(/^moxxy$/i)).toBeNull();
    const foot = entry?.querySelector('.tr__foot');
    expect(foot).not.toBeNull();
    expect(foot).toContainElement(screen.getByRole('button', { name: 'Copy' }));
    // Hours and minutes: a message is not a log line.
    expect(foot?.querySelector('.tr__meta')?.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('heads an error with a readable label', () => {
    render(<EventBlockView event={event({ type: 'error', message: 'Provider refused.', source: 'system' })} />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toBe('Provider refused.');
  });
});

describe('waiting on the agent', () => {
  it('shows thinking as the agent’s bubble, named for a screen reader', () => {
    render(<ThinkingIndicator />);
    const status = screen.getByRole('status', { name: 'Moxxy is thinking' });
    expect(status).toHaveClass('bubble', 'bubble--agent');
    expect(status).not.toHaveAttribute('style');
  });

  it('shows live reasoning as quiet text, not as a second answer', () => {
    render(<StreamingReasoning text="Weighing the two fixes." />);
    const block = screen.getByTestId('block-streaming-reasoning');
    expect(block).toHaveClass('reasoning');
    expect(block.querySelector('.bubble')).toBeNull();
    expect(block.textContent).toContain('Weighing the two fixes.');
  });
});
