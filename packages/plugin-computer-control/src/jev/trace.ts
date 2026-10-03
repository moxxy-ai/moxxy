import { appendFile } from 'node:fs/promises';
import type { AskJev, JevAnswers, JevQuestion } from './client.js';

/** How many of a Choice's options a line keeps, most likely first. */
const TOP = 3;

type Traced = Record<string, unknown>;

const lineFor = (elements: string, option: string) => elements.split('\n').find((line) => line.trimStart().startsWith(`[${option}]`))?.trim();

function summarizeQuestions(questions: Readonly<Record<string, JevQuestion>>): Traced {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, question.type === 'choice'
    ? { type: 'choice', options: Object.keys(question.criteria).length }
    : { type: 'noul' }]));
}

function summarizeAnswers(answers: JevAnswers, elements: string): Traced {
  return Object.fromEntries(Object.entries(answers).map(([id, answer]) => {
    if (answer.type === 'noul') return [id, { noul: answer.noul }];
    const top = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]).slice(0, TOP)
      .map(([option, probability]) => [option, probability, ...(lineFor(elements, option) ? [lineFor(elements, option)] : [])]);
    return [id, { choice: answer.choice, confidence: answer.confidence, top }];
  }));
}

/** `MOXXY_JEV_TRACE=<file>` turns the trace on. */
export const tracedFromEnv = (ask: AskJev): AskJev => {
  const file = process.env.MOXXY_JEV_TRACE;
  return file ? tracedJev(ask, file) : ask;
};

/**
 * Writes each request to Jev as one JSON line of `file`: the step it was about, how much of the window it was
 * shown, what it answered and how long it took. For measuring where runs go wrong; the window itself is not kept.
 */
export function tracedJev(ask: AskJev, file: string): AskJev {
  return async (state, questions, signal) => {
    const context = (state ?? {}) as Record<string, unknown>;
    const elements = typeof context.elements === 'string' ? context.elements : '';
    const { elements: _, ...rest } = context;
    const base = {
      at: new Date().toISOString(), ...rest,
      elements: elements === '' ? 0 : elements.split('\n').length,
      stateChars: JSON.stringify(state).length,
      questions: summarizeQuestions(questions),
    };
    const started = performance.now();
    const write = (entry: Traced) => appendFile(file, `${JSON.stringify({ ...base, ms: Math.round(performance.now() - started), ...entry })}\n`).catch(() => {});
    try {
      const answers = await ask(state, questions, signal);
      await write({ answers: summarizeAnswers(answers, elements) });
      return answers;
    } catch (error) {
      await write({ error: (error as Error).message });
      throw error;
    }
  };
}
