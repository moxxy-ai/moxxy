import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SubagentBlock } from '@moxxy/chat-model';
import { DisclosureRow } from './DisclosureRow';
import { SubagentView } from './SubagentView';

describe('DisclosureRow', () => {
  it('says whether it is open and toggles on a press', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <DisclosureRow state="done" label="Explore" open={false} onToggle={onToggle} />,
    );
    const row = screen.getByRole('button', { name: /Explore/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<DisclosureRow state="done" label="Explore" open onToggle={onToggle} />);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row.querySelector('.disclosure__chevron')).toHaveAttribute('data-open', 'true');
  });

  it('carries its state on the light and its count on the row', () => {
    render(
      <DisclosureRow state="running" label="Explore" meta="3 tool calls" live open={false} onToggle={() => {}} />,
    );
    const row = screen.getByRole('button');
    expect(row.querySelector('.led')).toHaveAttribute('data-state', 'running');
    expect(row).toContainElement(screen.getByText('3 tool calls'));
    expect(screen.getByText('Explore')).toHaveClass('activity-shimmer');
  });
});

describe('SubagentView', () => {
  const block = {
    kind: 'subagent',
    id: 'a1',
    label: 'Find the flaky test',
    toolCallCount: 3,
    toolCalls: [],
    completedAtMs: 2000,
    startedAtMs: 1000,
    error: null,
    stopReason: null,
    finalPreview: 'It is the PDF test.',
    tokensUsed: 0,
  } as unknown as SubagentBlock;

  it('is one activity entry with its count on the row, and opens to its output', () => {
    const { container } = render(<SubagentView block={block} />);
    expect(container.querySelectorAll('.tr')).toHaveLength(1);
    const row = screen.getByRole('button', { name: /Find the flaky test/ });
    expect(row).toContainElement(screen.getByText('3 tool calls'));
    expect(screen.queryByText('It is the PDF test.')).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText('It is the PDF test.')).toBeInTheDocument();
  });
});
