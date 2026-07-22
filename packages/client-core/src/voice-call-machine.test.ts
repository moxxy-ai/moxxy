import { describe, expect, it } from 'vitest';
import {
  createVoiceCallState,
  reduceVoiceCall,
  type VoiceCallEvent,
  type VoiceCallState,
} from './voice-call-machine.js';

function apply(events: ReadonlyArray<VoiceCallEvent>): VoiceCallState {
  return events.reduce(reduceVoiceCall, createVoiceCallState());
}

describe('voice call state machine', () => {
  it('runs the complete half-duplex cycle and returns to listening', () => {
    const state = apply([
      { type: 'open' },
      { type: 'ready' },
      { type: 'transcribing' },
      { type: 'transcript-ready' },
      { type: 'turn-started' },
      { type: 'synthesizing' },
      { type: 'speaking' },
      { type: 'turn-settled' },
    ]);

    expect(state).toEqual({
      active: true,
      phase: 'listening',
      errorReason: null,
      microphoneMuted: false,
    });
  });

  it('holds the turn while an approval is visible and resumes thinking afterwards', () => {
    const state = apply([
      { type: 'open' },
      { type: 'ready' },
      { type: 'transcribing' },
      { type: 'transcript-ready' },
      { type: 'turn-started' },
      { type: 'input-required' },
      { type: 'input-resolved' },
    ]);

    expect(state.phase).toBe('thinking');
  });

  it('returns to working after a conversational cue finishes during a tool run', () => {
    const state = apply([
      { type: 'open' },
      { type: 'ready' },
      { type: 'transcribing' },
      { type: 'transcript-ready' },
      { type: 'tool-started' },
      { type: 'synthesizing' },
      { type: 'speaking' },
      { type: 'speech-finished', resume: 'working' },
    ]);

    expect(state.phase).toBe('working');
  });

  it('mutes and unmutes the microphone without starting another turn', () => {
    const muted = apply([
      { type: 'open' },
      { type: 'ready' },
      { type: 'mute-microphone' },
    ]);
    expect(muted).toMatchObject({ phase: 'paused', microphoneMuted: true });

    const unmuted = reduceVoiceCall(muted, { type: 'unmute-microphone' });
    expect(unmuted).toMatchObject({ phase: 'listening', microphoneMuted: false });
  });

  it('preserves mute intent while Moxxy speaks and after the turn settles', () => {
    const mutedWhileSpeaking = apply([
      { type: 'open' },
      { type: 'ready' },
      { type: 'transcribing' },
      { type: 'transcript-ready' },
      { type: 'turn-started' },
      { type: 'speaking' },
      { type: 'mute-microphone' },
    ]);
    expect(mutedWhileSpeaking).toMatchObject({
      phase: 'speaking',
      microphoneMuted: true,
    });

    const settled = reduceVoiceCall(mutedWhileSpeaking, { type: 'turn-settled' });
    expect(settled).toMatchObject({ phase: 'paused', microphoneMuted: true });

    const unmuted = reduceVoiceCall(settled, { type: 'unmute-microphone' });
    expect(unmuted).toMatchObject({ phase: 'listening', microphoneMuted: false });
  });

  it('keeps an error visible until retry or close', () => {
    const failed = apply([
      { type: 'open' },
      { type: 'failed', reason: 'Local Piper is not active.' },
    ]);
    expect(failed).toEqual({
      active: true,
      phase: 'error',
      errorReason: 'Local Piper is not active.',
      microphoneMuted: false,
    });

    expect(reduceVoiceCall(failed, { type: 'retry' }).phase).toBe('checking');
    expect(reduceVoiceCall(failed, { type: 'close' })).toEqual(createVoiceCallState());
  });

  it('ignores late async events after the call has closed', () => {
    const closed = apply([
      { type: 'open' },
      { type: 'ready' },
      { type: 'close' },
      { type: 'speaking' },
      { type: 'failed', reason: 'late failure' },
    ]);

    expect(closed).toEqual(createVoiceCallState());
  });
});
