import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { badgeBackground, badgeMarker, Colors, contextColor, contextMarker, noColor } from './theme.js';

describe('theme accessibility cues', () => {
  describe('contextColor / contextMarker thresholds stay in lockstep', () => {
    it('danger (>=85%) carries both red and a ⚠ marker', () => {
      expect(contextColor(85)).toBe(Colors.danger);
      expect(contextColor(99)).toBe(Colors.danger);
      expect(contextMarker(85)).toBe(' ⚠');
      expect(contextMarker(99)).toBe(' ⚠');
    });

    it('warning (>=60% <85%) carries both yellow and a ! marker', () => {
      expect(contextColor(60)).toBe(Colors.busy);
      expect(contextColor(84)).toBe(Colors.busy);
      expect(contextMarker(60)).toBe(' !');
      expect(contextMarker(84)).toBe(' !');
    });

    it('safe (<60%) has no color and no marker — never a marker without color', () => {
      expect(contextColor(0)).toBeUndefined();
      expect(contextColor(59)).toBeUndefined();
      expect(contextMarker(0)).toBe('');
      expect(contextMarker(59)).toBe('');
    });

    it('every escalation that produces a color also produces a non-color marker', () => {
      for (let pct = 0; pct <= 100; pct++) {
        const hasColor = contextColor(pct) !== undefined;
        const hasMarker = contextMarker(pct) !== '';
        expect(hasMarker).toBe(hasColor);
      }
    });
  });

  describe('badgeBackground / badgeMarker', () => {
    it('attention modes get a magenta background AND a » text marker (color is never the sole signal)', () => {
      expect(badgeBackground('attention')).toBe(Colors.mode);
      expect(badgeMarker('attention')).toBe('» ');
    });

    it('info / undefined modes get chrome background and no extra marker', () => {
      expect(badgeBackground('info')).toBe(Colors.chrome);
      expect(badgeBackground(undefined)).toBe(Colors.chrome);
      expect(badgeMarker('info')).toBe('');
      expect(badgeMarker(undefined)).toBe('');
    });
  });

  describe('noColor honors NO_COLOR / MOXXY_NO_COLOR', () => {
    const saved = { NO_COLOR: process.env.NO_COLOR, MOXXY_NO_COLOR: process.env.MOXXY_NO_COLOR };
    beforeEach(() => {
      delete process.env.NO_COLOR;
      delete process.env.MOXXY_NO_COLOR;
    });
    afterEach(() => {
      if (saved.NO_COLOR === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = saved.NO_COLOR;
      if (saved.MOXXY_NO_COLOR === undefined) delete process.env.MOXXY_NO_COLOR;
      else process.env.MOXXY_NO_COLOR = saved.MOXXY_NO_COLOR;
    });

    it('is false when neither var is set', () => {
      expect(noColor()).toBe(false);
    });

    it('is true when NO_COLOR is set (even to empty-ish truthy values per the convention)', () => {
      process.env.NO_COLOR = '1';
      expect(noColor()).toBe(true);
    });

    it('is true when MOXXY_NO_COLOR is set', () => {
      process.env.MOXXY_NO_COLOR = '1';
      expect(noColor()).toBe(true);
    });
  });
});
