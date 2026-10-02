import { describe, expect, it } from 'vitest';
import { parseCases, train } from './train.js';

const file = { app: 'com.example.editor', cases: [
  { goal: 'Open Export', steps: [{ do: 'click', target: 'Export', expect: 'the sheet shows' }] },
  { goal: 'Close it', steps: [{ do: 'key', key: 'Escape' }] },
] };

describe('training cases', () => {
  it('are an app and the runs to try on it, each step a computer_run step', () => {
    expect(parseCases(file).cases).toHaveLength(2);
    expect(() => parseCases({ app: 'x', cases: [{ goal: 'g', steps: [{ do: 'fly' }] }] })).toThrow();
    expect(() => parseCases({ app: 'x', cases: [] })).toThrow();
  });
});

describe('train', () => {
  it('runs every case once per pass, in order, and reads how each went from the report', async () => {
    const sent: unknown[] = [];
    const run = async (input: unknown) => {
      sent.push(input);
      return sent.length === 2 ? 'computer_run: 0 of 1 steps done in 4.2 s (5 Jev decisions).\n1. FAILED' : 'computer_run: 1 of 1 steps done in 0.5 s (0 Jev decisions).';
    };
    const results = await train(parseCases(file), 2, run);
    expect(sent).toEqual([0, 1, 0, 1].map((index) => ({ app: file.app, ...file.cases[index] })));
    expect(results).toEqual([
      { pass: 1, goal: 'Open Export', done: true, seconds: 0.5, asked: 0 },
      { pass: 1, goal: 'Close it', done: false, seconds: 4.2, asked: 5 },
      { pass: 2, goal: 'Open Export', done: true, seconds: 0.5, asked: 0 },
      { pass: 2, goal: 'Close it', done: true, seconds: 0.5, asked: 0 },
    ]);
  });

  it('counts a case that could not run at all as not done, and goes on', async () => {
    const run = async (input: { goal: string }) => { if (input.goal === 'Open Export') throw new Error('helper gone'); return 'computer_run: 1 of 1 steps done in 0.5 s (0 Jev decisions).'; };
    const results = await train(parseCases(file), 1, run as never);
    expect(results.map((result) => result.done)).toEqual([false, true]);
    expect(results[0]).toMatchObject({ why: 'Error: helper gone' });
  });
});
