import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { pairToolEvents, type StepListBlock } from '@moxxy/chat-model';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { StepListDisplay } from '@moxxy/sdk/tool-display';
import { BlockView } from './BlockView';
import { TurnStepsBar } from '../composer/TurnStepsBar';

const steps: StepListDisplay = {
  kind: 'step-list',
  steps: [
    { text: 'Create a.txt containing a', status: 'completed' },
    { text: 'Create b.txt containing b', status: 'in_progress' },
    { text: 'Create c.txt containing c', status: 'pending' },
  ],
};

let seq = 0;
const event = (over: Record<string, unknown>): MoxxyEvent =>
  ({ id: `e${++seq}`, seq, ts: seq, sessionId: 's1', turnId: 't1', ...over }) as unknown as MoxxyEvent;

function listBlock(): StepListBlock {
  const blocks = pairToolEvents([
    event({ type: 'user_prompt', source: 'user', text: 'make three files' }),
    event({ type: 'tool_call_requested', source: 'model', callId: 'c1', name: 'TaskCreate', input: {}, executedBy: 'provider' }),
    event({ type: 'tool_result', source: 'tool', callId: 'c1', ok: true, output: { forModel: 'Task #1 created', display: steps } }),
  ]);
  const block = blocks.find((b): b is StepListBlock => b.kind === 'step-list');
  if (!block) throw new Error('no step list');
  return block;
}

describe("an agent's list of steps in the conversation", () => {
  it('shows every step with its state and how far the list is, not the calls that changed it', () => {
    render(<BlockView block={listBlock()} />);

    const list = screen.getByTestId('block-step-list');
    expect(list.textContent).toContain('Steps');
    expect(list.textContent).toContain('1 of 3 done');
    const items = list.querySelectorAll('li');
    expect([...items].map((item) => item.getAttribute('data-status'))).toEqual(['completed', 'in_progress', 'pending']);
    expect(items[1]?.textContent).toContain('Create b.txt containing b, in progress');
    expect(list.textContent).not.toContain('Task #1 created');
  });
});

describe('the steps bar above the composer', () => {
  it('says which step the agent is on, and shows the whole list when pressed', () => {
    render(<TurnStepsBar steps={steps} />);

    const bar = screen.getByRole('button', { name: /Step 2 of 3/ });
    expect(bar.textContent).toContain('Create b.txt containing b');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    fireEvent.click(bar);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('says the list is done once every step is', () => {
    render(<TurnStepsBar steps={{ kind: 'step-list', steps: steps.steps.map((step) => ({ ...step, status: 'completed' as const })) }} />);

    expect(screen.getByRole('button').textContent).toBe('3 of 3 steps done');
  });
});
