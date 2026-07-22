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

    expect(state).toEqual({ active: true, phase: 'listening', errorReason: null });
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

  it('can pause only the listening phase and resume without starting another turn', () => {
    const paused = apply([
      { type: 'open' },
      { type: 'ready' },
      { type: 'pause' },
    ]);
    expect(paused.phase).toBe('paused');

    const resumed = reduceVoiceCall(paused, { type: 'resume' });
    expect(resumed.phase).toBe('listening');

    const speaking = apply([
      { type: 'open' },
      { type: 'ready' },
      { type: 'transcribing' },
      { type: 'transcript-ready' },
      { type: 'turn-started' },
      { type: 'speaking' },
      { type: 'pause' },
    ]);
    expect(speaking.phase).toBe('speaking');
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
