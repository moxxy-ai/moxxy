import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReasoningMessageEvent } from '@moxxy/sdk';
import { ThinkingGroupView } from './ReasoningBlock';

const thought = (id: string, content: string, redacted = false): ReasoningMessageEvent =>
  ({ type: 'reasoning_message', id, content, ...(redacted ? { redacted: true } : {}) }) as unknown as ReasoningMessageEvent;

describe('ThinkingGroupView', () => {
  it('is one folded Thinking row for many thoughts, saying how many', () => {
    render(<ThinkingGroupView events={[thought('a', 'First idea'), thought('b', 'Second idea'), thought('c', 'Third idea')]} />);
    expect(screen.getAllByTestId('block-reasoning')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Thinking/ })).toHaveTextContent('Thinking3');
    expect(screen.queryByText('First idea')).toBeNull();
  });

  it('opens to every thought in order, a withheld one said in a line', () => {
    render(<ThinkingGroupView events={[thought('a', 'First idea'), thought('b', '', true), thought('c', 'Third idea')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Thinking/ }));
    const body = screen.getByTestId('reasoning-thoughts');
    expect(body.textContent).toMatch(/First idea.*Reasoning withheld.*Third idea/);
  });
});
