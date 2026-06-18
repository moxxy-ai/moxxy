import { describe, expect, it } from 'vitest';
import type { WorkflowTrigger } from '@moxxy/sdk';
import { slugify, triggerSummary } from './format.js';

describe('slugify', () => {
  it('lowercases and replaces runs of non-slug chars with a single hyphen', () => {
    expect(slugify('Daily Report')).toBe('daily-report');
    expect(slugify('A  B__C!!D')).toBe('a-b-c-d');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  !weird!  ')).toBe('weird');
    expect(slugify('---x---')).toBe('x');
  });

  it('caps at 60 chars', () => {
    expect(slugify('x'.repeat(100))).toHaveLength(60);
  });

  it('keeps existing valid slugs intact', () => {
    expect(slugify('already-a-slug')).toBe('already-a-slug');
  });
});

describe('triggerSummary', () => {
  it('returns on-demand for no trigger or an empty trigger', () => {
    expect(triggerSummary(undefined)).toBe('on-demand');
    expect(triggerSummary({} as WorkflowTrigger)).toBe('on-demand');
  });

  it('renders each trigger kind', () => {
    expect(triggerSummary({ schedule: { cron: '0 8 * * 1-5' } } as WorkflowTrigger)).toBe(
      'cron(0 8 * * 1-5)',
    );
    expect(triggerSummary({ schedule: { runAt: '2026-01-01' } } as WorkflowTrigger)).toBe('runAt');
    expect(triggerSummary({ afterWorkflow: 'other' } as WorkflowTrigger)).toBe('after(other)');
    expect(triggerSummary({ afterWorkflow: ['a', 'b'] } as WorkflowTrigger)).toBe('after(a,b)');
    expect(triggerSummary({ fileChanged: './x/**' } as WorkflowTrigger)).toBe('fileChanged');
    expect(triggerSummary({ webhook: 'hook' } as WorkflowTrigger)).toBe('webhook(hook)');
  });

  it('joins multiple triggers with " + "', () => {
    expect(
      triggerSummary({
        schedule: { cron: '* * * * *' },
        fileChanged: './x',
      } as WorkflowTrigger),
    ).toBe('cron(* * * * *) + fileChanged');
  });
});
