import { describe, expect, it } from 'vitest';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { resolveFocusMiniVoiceLabel } from './FocusMiniVoiceStatus';

describe('resolveFocusMiniVoiceLabel', () => {
  it.each<[VoiceCallPhase, string]>([
    ['idle', "I'm ready"],
    ['checking', "I'm preparing"],
    ['arming', "I'm preparing"],
    ['listening', "I'm listening"],
    ['transcribing', "I'm transcribing"],
    ['thinking', "I'm thinking"],
    ['working', "I'm working"],
    ['waiting-for-input', 'I need your input'],
    ['synthesizing', "I'm preparing my voice"],
    ['speaking', "I'm speaking"],
    ['paused', "I'm paused"],
    ['error', 'I need attention'],
  ])('describes %s in the first person', (phase, expected) => {
    expect(resolveFocusMiniVoiceLabel(phase)).toBe(expected);
  });
});
