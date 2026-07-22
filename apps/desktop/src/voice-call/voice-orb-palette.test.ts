import { describe, expect, it } from 'vitest';
import { resolveVoiceOrbPalette } from './voice-orb-palette';

function style(values: Readonly<Record<string, string>>) {
  return {
    getPropertyValue: (name: string) => values[name] ?? '',
  };
}

describe('resolveVoiceOrbPalette', () => {
  it('derives the orb from the active Moxxy brand token', () => {
    expect(resolveVoiceOrbPalette(style({ '--color-primary': '#ec4899' }), false)).toEqual({
      primary: '236, 72, 153',
      highlight: '245, 160, 202',
    });
  });

  it('uses the semantic error token and accepts computed rgb colors', () => {
    expect(resolveVoiceOrbPalette(style({ '--color-red': 'rgb(239, 68, 68)' }), true)).toEqual({
      primary: '239, 68, 68',
      highlight: '247, 158, 158',
    });
  });
});
