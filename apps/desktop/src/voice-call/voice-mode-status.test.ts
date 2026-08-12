import { describe, expect, it } from 'vitest';
import {
  resolveVoiceModeStatus,
  resolveVoicePhaseStatus,
} from './voice-mode-status.js';

describe('Voice Mode status presentation', () => {
  it('keeps the listening label shared across full Voice Mode and Mini Chat', () => {
    expect(resolveVoicePhaseStatus('listening')).toEqual({
      title: 'Listening',
      detail: 'Speak naturally. You can still type.',
    });
  });

  it('preserves the muted speaking and Local Piper overrides', () => {
    expect(resolveVoiceModeStatus({
      phase: 'speaking',
      microphoneMuted: true,
      localPiperInstallRequired: false,
      localPiperInstalling: false,
    }).detail).toBe('The microphone will stay off after this answer');

    expect(resolveVoiceModeStatus({
      phase: 'checking',
      microphoneMuted: false,
      localPiperInstallRequired: true,
      localPiperInstalling: true,
    }).title).toBe('Installing local voice');
  });
});
