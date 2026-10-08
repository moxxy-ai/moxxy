import { describe, expect, it } from 'vitest';
import { BANNER_BODY_LIMIT, bannerText } from './banner-text';

const prompt = (text: string) => ({ type: 'user_prompt', text });
const answer = (content: string) => ({ type: 'assistant_message', content });

describe('bannerText', () => {
  it('is headed by the chat and carries the answer as one plain line', () => {
    expect(
      bannerText({ reason: 'answered', name: 'Muffin recipe', events: [prompt('how long?'), answer('**Bake** for\n20 minutes.')] }),
    ).toEqual({ title: 'Muffin recipe', body: 'Bake for 20 minutes.' });
  });

  it('reads only what was said after the last prompt, so an old answer never stands in for a new one', () => {
    expect(
      bannerText({ reason: 'answered', name: 'Muffins', events: [prompt('one'), answer('Old answer.'), prompt('two')] }),
    ).toEqual({ title: 'Muffins', body: 'Finished without an answer.' });
  });

  it('says so when the conversation is not loaded in this window', () => {
    expect(bannerText({ reason: 'answered', name: 'Muffins', events: [] })).toEqual({
      title: 'Muffins',
      body: 'Finished without an answer.',
    });
  });

  it('says a chat is waiting when it stopped to ask', () => {
    expect(bannerText({ reason: 'asked', name: 'Deploy', events: [prompt('ship it'), answer('Running the script.')] })).toEqual({
      title: 'Deploy',
      body: 'Waiting for your decision.',
    });
  });

  it('cuts a long answer at the limit', () => {
    const { body } = bannerText({ reason: 'answered', name: 'Essay', events: [prompt('write'), answer('word '.repeat(200))] });

    expect(body.length).toBeLessThanOrEqual(BANNER_BODY_LIMIT);
    expect(body.endsWith('…')).toBe(true);
  });
});
