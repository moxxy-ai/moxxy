import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { selectFocusTaskStatus } from './focus-task-status';

function prompt(turnId: string, text: string, seq: number): MoxxyEvent {
  return {
    id: `event-${seq}`,
    seq,
    ts: seq,
    sessionId: 'session-focus',
    turnId,
    source: 'user',
    type: 'user_prompt',
    text,
  } as MoxxyEvent;
}

describe('selectFocusTaskStatus', () => {
  it('shows the prompt that belongs to the active turn, not an older task', () => {
    const status = selectFocusTaskStatus({
      events: [
        prompt('turn-old', 'Old task', 1),
        prompt('turn-active', '  Implement the Focus Mode task bubble  ', 2),
      ],
      activeTurnId: 'turn-active',
      sending: true,
      voiceModeActive: false,
      voiceModePhase: 'idle',
      activity: null,
    });

    expect(status).toEqual({
      key: 'turn-active',
      title: 'Moxxy',
      text: 'Implement the Focus Mode task bubble',
      busy: true,
    });
  });

  it('uses a safe activity label while a turn is starting before its prompt arrives', () => {
    const status = selectFocusTaskStatus({
      events: [],
      activeTurnId: 'turn-starting',
      sending: true,
      voiceModeActive: true,
      voiceModePhase: 'working',
      activity: 'editing',
    });

    expect(status).toEqual({
      key: 'turn-starting',
      title: 'Voice Mode',
      text: 'Writing changes',
      busy: true,
    });
  });

  it('shows transcription progress before the runner turn exists', () => {
    expect(selectFocusTaskStatus({
      events: [],
      activeTurnId: null,
      sending: false,
      voiceModeActive: true,
      voiceModePhase: 'transcribing',
      activity: null,
    })).toMatchObject({
      key: 'voice:transcribing',
      title: 'Voice Mode',
      text: 'Transcribing your message',
    });
  });

  it('stays absent when neither a turn nor a voice task is active', () => {
    expect(selectFocusTaskStatus({
      events: [prompt('turn-finished', 'Finished task', 1)],
      activeTurnId: null,
      sending: false,
      voiceModeActive: false,
      voiceModePhase: 'idle',
      activity: null,
    })).toBeNull();
  });
});
