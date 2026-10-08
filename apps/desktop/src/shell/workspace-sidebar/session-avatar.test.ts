import { describe, expect, it } from 'vitest';
import { sessionAvatar } from './session-avatar';

describe('sessionAvatar', () => {
  it('is stable for a session: the same id always draws the same avatar', () => {
    expect(sessionAvatar('s-1', 'Fix login')).toEqual(sessionAvatar('s-1', 'Fix login'));
  });

  it('keeps its colour through a rename, because the colour belongs to the id', () => {
    expect(sessionAvatar('s-1', 'Fix login').hue).toBe(sessionAvatar('s-1', 'Renamed').hue);
  });

  it('spreads sessions over the palette instead of one colour', () => {
    const hues = new Set(
      Array.from({ length: 40 }, (_, i) => sessionAvatar(`session-${i}`, 'x').hue),
    );
    expect(hues.size).toBeGreaterThan(6);
    for (const hue of hues) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('draws the first letter or digit of the name, upper-cased', () => {
    expect(sessionAvatar('a', 'fix the login bug').glyph).toBe('F');
    expect(sessionAvatar('a', '  “cześć” świecie').glyph).toBe('C');
    expect(sessionAvatar('a', '42 things').glyph).toBe('4');
    expect(sessionAvatar('a', 'żółw').glyph).toBe('Ż');
  });

  it('falls back to a neutral mark when the name has nothing to draw', () => {
    expect(sessionAvatar('a', '').glyph).toBe('#');
    expect(sessionAvatar('a', '🚀 …').glyph).toBe('#');
  });
});
