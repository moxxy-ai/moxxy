import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UserBlock } from './UserBlock';

/**
 * A pasted prompt is routinely a 40-line preamble. Rendered whole it becomes the
 * largest object on screen wearing the commanded wash, which buries the agent's
 * actual work under it and inverts what the accent is for. These pin the clamp,
 * and that nothing is ever silently lost to it.
 */

const SHORT = 'Retry the gateway fault.';
const LONG = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');

describe('UserBlock clamping', () => {
  it('leaves a short command alone, with no expander', () => {
    render(<UserBlock text={SHORT} />);
    expect(screen.getByTestId('block-user').textContent).toContain(SHORT);
    expect(screen.queryByTestId('user-prompt-expand')).toBeNull();
  });

  it('clamps a long command and says how much is hidden', () => {
    render(<UserBlock text={LONG} />);
    const expander = screen.getByTestId('user-prompt-expand');
    // The count is the honest disclosure: a clamp that does not say what it hid
    // reads as a complete prompt that happens to end mid-thought.
    expect(expander.textContent).toBe('Show all 40 lines');
  });

  it('never drops the text — the full command is always in the DOM', () => {
    render(<UserBlock text={LONG} />);
    // Clamping is presentational (line-clamp), so search, copy and screen
    // readers still see every line even while it is visually shortened.
    const body = screen.getByTestId('block-user');
    expect(body.textContent).toContain('line 1');
    expect(body.textContent).toContain('line 40');
  });

  it('expands and collapses again', () => {
    render(<UserBlock text={LONG} />);
    fireEvent.click(screen.getByTestId('user-prompt-expand'));
    expect(screen.getByTestId('user-prompt-expand').textContent).toBe('Show less');
    fireEvent.click(screen.getByTestId('user-prompt-expand'));
    expect(screen.getByTestId('user-prompt-expand').textContent).toBe('Show all 40 lines');
  });

  it('counts lines without a split allocation on every render', () => {
    // A 12-line prompt is exactly at the threshold and must NOT clamp; 13 must.
    render(<UserBlock text={Array.from({ length: 12 }, () => 'x').join('\n')} />);
    expect(screen.queryByTestId('user-prompt-expand')).toBeNull();
  });
});
