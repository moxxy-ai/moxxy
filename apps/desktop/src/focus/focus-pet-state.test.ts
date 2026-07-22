import { describe, expect, it } from 'vitest';
import { resolveFocusPetPhase, shouldNudgeFocusPet } from './focus-pet-state';

describe('resolveFocusPetPhase', () => {
  it('keeps the voice-call state authoritative while the call is active', () => {
    expect(resolveFocusPetPhase({
      voiceModeActive: true,
      voiceModePhase: 'speaking',
      recording: true,
      transcribing: true,
    })).toBe('speaking');
  });

  it('reflects one-shot recording and transcription outside Voice Mode', () => {
    expect(resolveFocusPetPhase({
      voiceModeActive: false,
      voiceModePhase: 'idle',
      recording: true,
      transcribing: false,
    })).toBe('listening');
    expect(resolveFocusPetPhase({
      voiceModeActive: false,
      voiceModePhase: 'idle',
      recording: false,
      transcribing: true,
    })).toBe('transcribing');
  });
});

describe('shouldNudgeFocusPet', () => {
  it('uses one restrained attention motion when work enters a new phase', () => {
    expect(shouldNudgeFocusPet('listening', 'transcribing')).toBe(true);
    expect(shouldNudgeFocusPet('thinking', 'working')).toBe(true);
    expect(shouldNudgeFocusPet('working', 'waiting-for-input')).toBe(true);
  });

  it('does not bounce continuously or shake for errors', () => {
    expect(shouldNudgeFocusPet('thinking', 'thinking')).toBe(false);
    expect(shouldNudgeFocusPet('speaking', 'listening')).toBe(false);
    expect(shouldNudgeFocusPet('working', 'error')).toBe(false);
  });
});
