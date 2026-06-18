import { describe, expect, it } from 'vitest';
import {
  appendStreamingTranscript,
  buildCommittedChatTranscript,
} from '../mobile/src/chatTranscript';

describe('mobile chat transcript streaming performance', () => {
  it('appends live assistant text without rebuilding committed transcript items', () => {
    const committed = buildCommittedChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Tell me something' },
      { id: 'a1', type: 'assistant_message', text: 'A settled reply.' },
    ]);

    const firstChunk = appendStreamingTranscript(committed, 'Live');
    const secondChunk = appendStreamingTranscript(committed, 'Live reply');

    expect(firstChunk).toHaveLength(committed.length + 1);
    expect(secondChunk).toHaveLength(committed.length + 1);
    expect(secondChunk[0]).toBe(committed[0]);
    expect(secondChunk[1]).toBe(committed[1]);
    expect(secondChunk[2]).toMatchObject({
      id: 'assistant-stream:external',
      kind: 'assistant',
      streaming: true,
      text: 'Live reply',
    });
  });
});
