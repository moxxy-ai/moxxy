import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JevError, type AskJev } from './client.js';
import { traceRun, tracedJev } from './trace.js';

const never = new AbortController().signal;
const state = { goal: 'sort by price', step: { do: 'click', target: 'Sort menu' }, app: 'Safari', elements: '[1] AXButton "Menu"\n  [2] AXPopUpButton "Sort"\n[3] AXLink "Help"' };
const questions = {
  target: { type: 'choice' as const, instructions: 'Which element?', criteria: { 1: null, 2: null, 3: null, none: 'None.' } },
  already: { type: 'noul' as const, instructions: 'Done already?' },
};

const linesOf = async (file: string) => (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

describe('tracedJev', () => {
  it('writes one line per request: the step, how big the window was, and what Jev answered', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'jev-trace-')), 'trace.ndjson');
    const ask: AskJev = async () => ({
      target: { type: 'choice', choice: '2', probabilities: { 1: 0.3, 2: 0.6, 3: 0.05, none: 0.05 }, confidence: 0.4 },
      already: { type: 'noul', noul: 0.1 },
    });
    await expect(tracedJev(ask, file)(state, questions, never)).resolves.toMatchObject({ already: { noul: 0.1 } });

    const [line] = await linesOf(file);
    expect(line).toMatchObject({
      goal: 'sort by price', step: { do: 'click', target: 'Sort menu' }, app: 'Safari',
      elements: 3, stateChars: JSON.stringify(state).length,
      questions: { target: { type: 'choice', options: 4 }, already: { type: 'noul' } },
      answers: {
        target: { choice: '2', confidence: 0.4, top: [['2', 0.6, '[2] AXPopUpButton "Sort"'], ['1', 0.3, '[1] AXButton "Menu"'], ['3', 0.05, '[3] AXLink "Help"']] },
        already: { noul: 0.1 },
      },
    });
    expect(line?.ms).toEqual(expect.any(Number));
  });

  it('keeps what a step types out of the file, and the file to its owner', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'jev-trace-')), 'trace.ndjson');
    const ask: AskJev = async () => ({ already: { type: 'noul', noul: 0.1 } });
    const typing = { ...state, step: { do: 'type', target: 'Password field', text: 'hunter2' }, performed: { do: 'set_value', target: 'PIN', text: '1234' } };
    await tracedJev(ask, file)(typing, { already: questions.already }, never);

    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('1234');
    expect((await linesOf(file))[0]).toMatchObject({
      step: { do: 'type', target: 'Password field', text: '[7 characters]' },
      performed: { do: 'set_value', target: 'PIN', text: '[4 characters]' },
    });
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('records a failed request and passes the failure on', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'jev-trace-')), 'trace.ndjson');
    const failing: AskJev = async () => { throw new JevError(0, 'Jev did not answer: timeout'); };
    await expect(tracedJev(failing, file)(state, questions, never)).rejects.toThrow('timeout');
    expect((await linesOf(file))[0]).toMatchObject({ error: 'Jev did not answer: timeout' });
  });
});

describe('traceRun', () => {
  it('writes a line per run with where its time went, next to the requests to Jev', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'jev-trace-')), 'trace.ndjson');
    await traceRun(file, { app: 'Safari', goal: 'Search', steps: 2, ms: 900, asks: 3, time: { jev: 400, act: 300, look: 100 }, outcomes: ['verified', 'done'] });
    const [line] = await linesOf(file);
    expect(line).toMatchObject({ run: { app: 'Safari', goal: 'Search', steps: 2, ms: 900, asks: 3, time: { jev: 400, act: 300, look: 100 }, outcomes: ['verified', 'done'] } });
    expect(line?.at).toEqual(expect.any(String));
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('writes nothing without a trace file', async () => {
    await expect(traceRun(undefined, { app: 'Safari', goal: 'Search', steps: 1, ms: 1, asks: 0, time: { jev: 0, act: 0, look: 0 }, outcomes: [] })).resolves.toBeUndefined();
  });
});
