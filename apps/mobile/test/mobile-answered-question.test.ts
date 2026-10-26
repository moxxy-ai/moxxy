import { describe, expect, it } from 'vitest';
import { buildChatTranscript } from '../src/chatTranscript';

/**
 * Once the person answers a Question its card goes away; the phone's transcript
 * keeps what they chose in view, not folded into the collapsed Tools group.
 */
describe('an answered Question in the mobile transcript', () => {
  it('shows each question with what the person chose as its own item', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Zrób przycisk' },
      { id: 'r1', type: 'tool_call_requested', callId: 'c1', name: 'ask_user', input: {} },
      {
        id: 'r2',
        type: 'tool_result',
        callId: 'c1',
        ok: true,
        output: {
          forModel: 'The user answered: …',
          display: {
            kind: 'question-answer',
            questions: [
              { header: 'Colour', question: 'Which colour?', chosen: ['Blue'] },
              { question: 'Which parts?', chosen: [], own: 'only auth' },
            ],
          },
        },
      },
    ]);

    expect(transcript).toEqual([
      { id: 'u1', kind: 'user', text: 'Zrób przycisk' },
      {
        id: 'answered:c1',
        kind: 'answered',
        title: 'You answered',
        lines: ['Colour: Which colour? → Blue', 'Which parts? → own answer: only auth'],
      },
    ]);
  });
});
