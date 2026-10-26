import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkNode } from '@moxxy/client-core';
import { WorkGroupView } from './WorkGroupView';
import { workGroupLabel } from './useWorkGroup';

afterEach(cleanup);

const group = (over: Partial<WorkNode> = {}): WorkNode => ({
  kind: 'work',
  id: 'work:a',
  nodes: [],
  steps: 12,
  startedAtMs: 0,
  endedAtMs: 252_000,
  ...over,
});

describe('workGroupLabel', () => {
  it('says how long the agent worked and in how many steps', () => {
    expect(workGroupLabel(group())).toEqual({ label: 'Worked for 4m 12s', steps: '12 steps' });
    expect(workGroupLabel(group({ endedAtMs: 9_400, steps: 1 }))).toEqual({ label: 'Worked for 9s', steps: '1 step' });
    expect(workGroupLabel(group({ endedAtMs: 3_900_000 }))).toEqual({ label: 'Worked for 1h 5m', steps: '12 steps' });
  });

  it('says only that it worked when the time is unknown or too short to say', () => {
    expect(workGroupLabel(group({ startedAtMs: null })).label).toBe('Worked');
    expect(workGroupLabel(group({ endedAtMs: 400 })).label).toBe('Worked');
  });
});

describe('WorkGroupView', () => {
  it('shows the work folded, and all of it when opened', () => {
    render(
      <WorkGroupView group={group()}>
        <p>Found it in server.ts.</p>
      </WorkGroupView>,
    );
    const header = screen.getByRole('button', { name: /Worked for 4m 12s/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveTextContent('12 steps');
    expect(screen.queryByText('Found it in server.ts.')).toBeNull();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Found it in server.ts.')).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByText('Found it in server.ts.')).toBeNull();
  });
});
