import { z } from 'zod';

/** TypeSafe's System One endpoint: one state, many typed questions, answered in parallel. */
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_HOST = 'api.typesafe.ai';
export const JEV_MODEL = 'jev-latest';
/** The vault secret (or environment variable) that holds the TypeSafe API key. */
export const JEV_SECRET = 'TYPESAFE_API_KEY';

/** A decision that takes longer than this is slower than asking the main model. */
const TIMEOUT_MS = 8_000;
const BUSY = new Set([429, 529]);

export type JevQuestion =
  | { readonly type: 'choice'; readonly instructions: string; readonly criteria: Readonly<Record<string, string | null>> }
  | { readonly type: 'noul'; readonly instructions: string; readonly criteria?: { readonly true: string; readonly false: string } };

const choiceAnswer = z.object({ type: z.literal('choice'), choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number() });
const noulAnswer = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });
const responseSchema = z.object({ answers: z.record(z.string(), z.discriminatedUnion('type', [choiceAnswer, noulAnswer])) });

export type ChoiceAnswer = z.infer<typeof choiceAnswer>;
export type NoulAnswer = z.infer<typeof noulAnswer>;
export type JevAnswers = Readonly<Record<string, ChoiceAnswer | NoulAnswer>>;

/** One request to Jev. Every question is judged against the same state; none sees another's answer. */
export type AskJev = (state: unknown, questions: Readonly<Record<string, JevQuestion>>, signal: AbortSignal) => Promise<JevAnswers>;

export class JevError extends Error {
  /** The HTTP status, or 0 when no answer arrived. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'JevError';
    this.status = status;
  }
}

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

export function jevClient(apiKey: string, fetcher: typeof fetch = fetch): AskJev {
  const send = async (body: string, signal: AbortSignal): Promise<Response> => {
    try {
      return await fetcher(JEV_ENDPOINT, {
        method: 'POST', body, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new JevError(0, `Jev did not answer: ${(error as Error).message}`);
    }
  };

  return async (state, questions, signal) => {
    const body = JSON.stringify({ model: JEV_MODEL, state, questions });
    let response = await send(body, signal);
    if (BUSY.has(response.status)) {
      await pause(Math.min(Number(response.headers.get('retry-after') ?? 0.3) * 1000, 2_000), signal);
      response = await send(body, signal);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300).replaceAll(apiKey, '[key]');
      throw new JevError(response.status, `Jev returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const parsed = responseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new JevError(response.status, 'Jev returned an answer in an unknown shape');
    for (const [id, question] of Object.entries(questions)) {
      if (parsed.data.answers[id]?.type !== question.type) throw new JevError(response.status, `Jev did not answer "${id}"`);
    }
    return parsed.data.answers;
  };
}
