import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  RemoteAudioSpectrum,
  parseDesktopVoiceCallMessage,
} from './desktop-voice-call-bridge';

describe('desktop voice-call bridge validation', () => {
  it('accepts only bounded, presentation-safe snapshots', () => {
    expect(parseDesktopVoiceCallMessage({
      type: 'snapshot',
      source: 'main',
      workspaceId: 'ws-1',
      snapshot: {
        active: true,
        phase: 'listening',
        activity: null,
        errorReason: null,
        microphoneMuted: false,
        waitingSoundEnabled: true,
        localPiperInstallRequired: false,
        localPiperInstalling: false,
      },
    })).not.toBeNull();

    expect(parseDesktopVoiceCallMessage({
      type: 'snapshot',
      source: 'main',
      workspaceId: 'ws-1',
      snapshot: {
        active: true,
        phase: 'listening',
        activity: null,
        errorReason: 'x'.repeat(501),
        microphoneMuted: false,
        waitingSoundEnabled: true,
        localPiperInstallRequired: false,
        localPiperInstalling: false,
      },
    })).toBeNull();
  });

  it('rejects unknown commands and oversized audio payloads', () => {
    expect(parseDesktopVoiceCallMessage({
      type: 'command',
      source: 'focus',
      workspaceId: 'ws-1',
      command: 'read-user-files',
    })).toBeNull();

    expect(parseDesktopVoiceCallMessage({
      type: 'spectrum',
      source: 'main',
      workspaceId: 'ws-1',
      audioSource: 'microphone',
      bins: new Uint8Array(4_097),
    })).toBeNull();
  });

  it('accepts the fixed Local Piper install command', () => {
    expect(parseDesktopVoiceCallMessage({
      type: 'command',
      source: 'focus',
      workspaceId: 'ws-1',
      command: 'install-local-piper',
    })).not.toBeNull();
  });

  it('accepts Uint8Array spectrum frames cloned from another renderer realm', () => {
    const bins = runInNewContext('new Uint8Array([2, 4, 8])') as Uint8Array;
    expect(bins instanceof Uint8Array).toBe(false);

    expect(parseDesktopVoiceCallMessage({
      type: 'spectrum',
      source: 'main',
      workspaceId: 'ws-1',
      audioSource: 'assistant',
      bins,
    })).not.toBeNull();
  });
});

describe('RemoteAudioSpectrum', () => {
  it('exposes the latest cloned bins through the analyser contract', () => {
    const spectrum = new RemoteAudioSpectrum();
    const bins = new Uint8Array([3, 8, 13]);

    spectrum.update(bins);
    bins[0] = 255;

    const target = new Uint8Array(5);
    spectrum.getByteFrequencyData(target);
    expect(spectrum.frequencyBinCount).toBe(3);
    expect([...target]).toEqual([3, 8, 13, 0, 0]);
  });
});
