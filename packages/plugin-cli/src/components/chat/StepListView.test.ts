import { describe, expect, it } from 'vitest';
import type { StepListDisplay } from '@moxxy/sdk';
import { stepListHeading, stepListLines } from './StepListView.js';

const display: StepListDisplay = {
  kind: 'step-list',
  steps: [
    { text: 'Create a.txt', status: 'completed' },
    { text: 'Create b.txt', status: 'in_progress' },
    { text: 'Create c.txt', status: 'pending' },
    { text: 'Create d.txt', status: 'cancelled' },
  ],
};

describe("an agent's list of steps in the terminal", () => {
  it('says how far the list is', () => {
    expect(stepListHeading(display)).toBe('Steps · 2 of 4 done');
  });

  it('marks every step so its state reads without color', () => {
    expect(stepListLines(display).map((line) => `${line.mark} ${line.text}`)).toEqual([
      '✓ Create a.txt',
      '● Create b.txt',
      '○ Create c.txt',
      '✗ Create d.txt',
    ]);
  });
});
