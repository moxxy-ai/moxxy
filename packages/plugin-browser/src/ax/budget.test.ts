import { describe, expect, it } from 'vitest';
import { BRIEF_READ_BUDGET, FULL_READ_BUDGET, READ_BUDGET, withinBudget } from './budget.js';

/**
 * A read of Coolify's service catalogue came back at 178,073 characters and
 * cost +48,011 tokens in one call; the agent then carried it through every
 * later call of the task. A read now has a ceiling, and what it leaves out it
 * says it left out, with the way to get at the rest.
 */
const rows = (n: number) => Array.from({ length: n }, (_, i) => `[${i + 1}] link: "Service ${i + 1}"`).join('\n');

describe('withinBudget', () => {
  it('leaves a read that fits alone', () => {
    const text = rows(10);

    expect(withinBudget(text, READ_BUDGET)).toBe(text);
  });

  it('cuts a large read at a whole row and says how much it left out', () => {
    const text = rows(20_000);

    const out = withinBudget(text, READ_BUDGET);

    expect(out.length).toBeLessThanOrEqual(READ_BUDGET + 400);
    const kept = out.split('\n').filter((line) => line.startsWith('['));
    // Every kept row is whole: the cut never lands inside one.
    for (const line of kept) expect(line).toMatch(/^\[\d+\] link: "Service \d+"$/);
    expect(out).toContain(`${20_000 - kept.length} more rows`);
    expect(out).toContain('browser_find');
  });

  it('gives the read that closes a run of steps less room than a read asked for', () => {
    expect(BRIEF_READ_BUDGET).toBeLessThan(READ_BUDGET);
    expect(withinBudget(rows(20_000), BRIEF_READ_BUDGET).length).toBeLessThanOrEqual(BRIEF_READ_BUDGET + 400);
  });

  it('gives a full read more room, but still a ceiling', () => {
    const text = rows(20_000);

    const out = withinBudget(text, FULL_READ_BUDGET);

    expect(FULL_READ_BUDGET).toBeGreaterThan(READ_BUDGET);
    expect(out.length).toBeLessThanOrEqual(FULL_READ_BUDGET + 400);
  });
});
