import { describe, expect, it } from 'vitest';
import { deriveVoiceTranscriptLines } from './voice-transcript';

describe('deriveVoiceTranscriptLines', () => {
  it('projects the latest exchange from the same event log plus the live assistant tail', () => {
    const lines = deriveVoiceTranscriptLines([
      { type: 'user_prompt', turnId: 't1', text: 'Starsze pytanie' },
      { type: 'assistant_message', turnId: 't1', content: 'Starsza odpowiedź' },
      { type: 'user_prompt', turnId: 't2', text: 'Jak zaparzyć kawę?' },
    ] as never, 'Zmiel ziarna tuż przed', null, 3);

    expect(lines).toEqual([
      { role: 'assistant', text: 'Starsza odpowiedź', streaming: false },
      { role: 'user', text: 'Jak zaparzyć kawę?', streaming: false },
      { role: 'assistant', text: 'Zmiel ziarna tuż przed', streaming: true },
    ]);
  });

  it('shows a freshly transcribed sentence only until the runner commits it', () => {
    const provisional = deriveVoiceTranscriptLines([], '', 'Opowiedz mi o kawie');
    expect(provisional).toEqual([
      { role: 'user', text: 'Opowiedz mi o kawie', streaming: true },
    ]);

    const committed = deriveVoiceTranscriptLines([
      { type: 'user_prompt', turnId: 't1', text: 'Opowiedz mi o kawie' },
    ] as never, '', 'Opowiedz mi o kawie');
    expect(committed).toHaveLength(1);
    expect(committed[0]?.streaming).toBe(false);
  });

  it('ignores tool and reasoning events in the quiet transcript', () => {
    const lines = deriveVoiceTranscriptLines([
      { type: 'tool_call_requested', turnId: 't1', name: 'Read', input: {} },
      { type: 'reasoning', turnId: 't1', content: 'secret chain' },
    ] as never, '', null);
    expect(lines).toEqual([]);
  });
});
