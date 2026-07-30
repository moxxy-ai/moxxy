import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { callDuration, stepDuration, stepLabel, ToolRows, STEP_PREVIEW_ROWS, type ToolRowData } from './SkillGroupView';

/**
 * A step is the unit a run is actually read in. Two things make it readable and
 * both are pinned here: it says WHICH step it is, and it shows the opening of its
 * work without dumping all of it. Durations are MEASURED (both events carry `ts`),
 * so the tests also pin that nothing is estimated when the data is missing.
 */

function row(over: Partial<ToolRowData> & { id: string }): ToolRowData {
  return {
    name: 'Read',
    input: { file_path: 'a.ts' },
    outcome: null,
    requestedAt: 0,
    ...over,
  };
}

function done(id: string, requestedAt: number, ts: number, name = 'Read'): ToolRowData {
  return row({
    id,
    name,
    requestedAt,
    outcome: { type: 'tool_result', ok: true, ts } as unknown as ToolRowData['outcome'],
  });
}

describe('stepLabel', () => {
  it('numbers the step when it has an ordinal', () => {
    expect(stepLabel(3, 'Ran 6 tools')).toBe('step 3 · Ran 6 tools');
  });

  it('degrades to the plain summary rather than faking a number', () => {
    expect(stepLabel(undefined, 'Ran 6 tools')).toBe('Ran 6 tools');
  });
});

describe('durations', () => {
  it('measures one call from its request to its result', () => {
    expect(callDuration(done('a', 1_000, 1_310))).toBe('310ms');
    expect(callDuration(done('b', 0, 3_200))).toBe('3.2s');
    expect(callDuration(done('c', 0, 64_000))).toBe('64s');
  });

  it('reports NOTHING for a call still in flight or denied', () => {
    expect(callDuration(row({ id: 'x' }))).toBeNull();
    expect(
      callDuration(row({ id: 'y', outcome: { type: 'denied', reason: 'no' } })),
    ).toBeNull();
  });

  it('spans a whole step from its first request to its last result', () => {
    expect(stepDuration([done('a', 1_000, 2_000), done('b', 1_500, 4_200)])).toBe('3.2s');
  });

  it('reports nothing for a step with no finished call', () => {
    expect(stepDuration([row({ id: 'x' })])).toBeNull();
    expect(stepDuration([])).toBeNull();
  });
});

describe('ToolRows', () => {
  const many = Array.from({ length: 9 }, (_, i) => done(`t${i}`, 0, 100, i < 5 ? 'Read' : 'Bash'));

  it('shows the opening of the step and folds the rest', () => {
    render(<ToolRows rows={many} open={false} onExpand={() => {}} />);
    // All-or-nothing was the bug: collapsed hid the work entirely, expanded let
    // sixteen rows push the agent's answer off the screen.
    expect(screen.getAllByRole('listitem')).toHaveLength(STEP_PREVIEW_ROWS);
    expect(screen.getByRole('button', { name: /5 more calls/ })).toBeTruthy();
  });

  it('names what is behind the fold, so it summarises rather than just opens', () => {
    render(<ToolRows rows={many} open={false} onExpand={() => {}} />);
    expect(screen.getByRole('button', { name: /5 more calls/ }).textContent).toContain('Bash');
  });

  it('shows everything and drops the fold once open', () => {
    render(<ToolRows rows={many} open onExpand={() => {}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    expect(screen.queryByRole('button', { name: /more calls/ })).toBeNull();
  });

  it('does not fold a step that fits', () => {
    render(<ToolRows rows={many.slice(0, STEP_PREVIEW_ROWS)} open={false} onExpand={() => {}} />);
    expect(screen.queryByRole('button', { name: /more calls/ })).toBeNull();
  });
});
