import { describe, expect, it } from 'vitest';
import {
  resolveVoiceAvatarFrame,
  smoothVoiceAvatarAmplitude,
} from './voice-avatar-animation';

describe('resolveVoiceAvatarFrame', () => {
  it('keeps the resting face outside speech and lets blinking take priority', () => {
    expect(resolveVoiceAvatarFrame({
      speaking: false,
      blinking: false,
      amplitude: 1,
      mouthFrame: 6,
    })).toBe('idle');
    expect(resolveVoiceAvatarFrame({
      speaking: true,
      blinking: true,
      amplitude: 1,
      mouthFrame: 6,
    })).toBe('blink');
  });

  it('maps Piper amplitude to restrained mouth shapes', () => {
    expect(resolveVoiceAvatarFrame({
      speaking: true,
      blinking: false,
      amplitude: 0.06,
      mouthFrame: 1,
    })).toBe('idle');
    expect(resolveVoiceAvatarFrame({
      speaking: true,
      blinking: false,
      amplitude: 0.2,
      mouthFrame: 1,
    })).toBe('medium');
    expect(resolveVoiceAvatarFrame({
      speaking: true,
      blinking: false,
      amplitude: 0.6,
      mouthFrame: 1,
    })).toBe('wide');
    expect(resolveVoiceAvatarFrame({
      speaking: true,
      blinking: false,
      amplitude: 0.6,
      mouthFrame: 6,
    })).toBe('round');
  });
});

describe('smoothVoiceAvatarAmplitude', () => {
  it('moves towards the next bounded level without overshooting', () => {
    expect(smoothVoiceAvatarAmplitude(0, 2, 1 / 60)).toBeGreaterThan(0);
    expect(smoothVoiceAvatarAmplitude(0, 2, 1 / 60)).toBeLessThanOrEqual(1);
    expect(smoothVoiceAvatarAmplitude(0.8, -1, 1 / 60)).toBeGreaterThanOrEqual(0);
  });
});
