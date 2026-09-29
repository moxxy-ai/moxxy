import { describe, expect, it } from 'vitest';
import { GptLiveOutbox } from './gpt-live-outbox';

describe('GptLiveOutbox', () => {
  it('passes messages straight through while GPT-Live is not speaking', () => {
    const outbox = new GptLiveOutbox();

    expect(outbox.offer(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('holds messages while GPT-Live speaks and releases them in order when it stops', () => {
    const outbox = new GptLiveOutbox();
    outbox.speakingStarted();

    expect(outbox.offer(['progress'])).toEqual([]);
    expect(outbox.offer(['result-1', 'result-2'])).toEqual([]);
    expect(outbox.speakingFinished()).toEqual(['progress', 'result-1', 'result-2']);
    expect(outbox.offer(['later'])).toEqual(['later']);
  });

  it('releases nothing when it was not holding anything', () => {
    const outbox = new GptLiveOutbox();

    expect(outbox.speakingFinished()).toEqual([]);
    outbox.speakingStarted();
    expect(outbox.speakingFinished()).toEqual([]);
  });
});
