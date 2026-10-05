import { describe, expect, it } from 'vitest';
import { JEV_ENDPOINT, JevError, jevClient, type JevQuestion } from './client.js';

const questions: Record<string, JevQuestion> = {
  target: { type: 'choice', instructions: 'Which element?', criteria: { 1: null, none: 'No element fits.' } },
  done: { type: 'noul', instructions: 'Is it done?' },
};
const answers = {
  target: { type: 'choice', choice: '1', probabilities: { 1: 0.9, none: 0.1 }, confidence: 0.8 },
  done: { type: 'noul', noul: 0.2 },
};
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const never = new AbortController().signal;

describe('jevClient', () => {
  it('sends the state and the questions in one request and returns the typed answers', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const ask = jevClient('secret-key', async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      return reply(200, { model: 'jev-1.13.0', answers, usage: { input_tokens: 10, output_tokens: 2 } });
    });
    expect(await ask({ app: 'TextEdit' }, questions, never)).toEqual(answers);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(JEV_ENDPOINT);
    expect(seen[0]?.init.method).toBe('POST');
    expect(new Headers(seen[0]?.init.headers).get('authorization')).toBe('Bearer secret-key');
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({ model: 'jev-latest', state: { app: 'TextEdit' }, questions });
  });

  it('tries once more when the service is busy, then gives up', async () => {
    let calls = 0;
    const busyOnce = jevClient('k', async () => ((calls += 1) === 1 ? reply(429, { error: 'slow down' }, { 'retry-after': '0' }) : reply(200, { answers })));
    expect(await busyOnce({}, questions, never)).toEqual(answers);
    expect(calls).toBe(2);
    const busy = jevClient('k', async () => reply(529, { error: 'overloaded' }, { 'retry-after': '0' }));
    await expect(busy({}, questions, never)).rejects.toMatchObject({ name: 'JevError', status: 529 });
  });

  it('reports a rejected key without repeating it, and does not retry', async () => {
    let calls = 0;
    const ask = jevClient('secret-key', async () => { calls += 1; return reply(401, { error: { message: 'bad key secret-key' } }); });
    const error = await ask({}, questions, never).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).status).toBe(401);
    expect((error as JevError).message).not.toContain('secret-key');
    expect(calls).toBe(1);
  });

  it('refuses an answer that is not what was asked', async () => {
    const missing = jevClient('k', async () => reply(200, { answers: { target: answers.target } }));
    await expect(missing({}, questions, never)).rejects.toBeInstanceOf(JevError);
    const wrongType = jevClient('k', async () => reply(200, { answers: { ...answers, done: answers.target } }));
    await expect(wrongType({}, questions, never)).rejects.toBeInstanceOf(JevError);
  });

  it('turns a network failure into a Jev error', async () => {
    const ask = jevClient('k', async () => { throw new TypeError('fetch failed'); });
    await expect(ask({}, questions, never)).rejects.toMatchObject({ name: 'JevError', status: 0 });
  });
});
