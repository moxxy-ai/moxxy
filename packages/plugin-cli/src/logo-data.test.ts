import { describe, expect, it } from 'vitest';
import {
  COMPACT_LOGO_LINES,
  COMPACT_LOGO_WIDTH,
  LOGO_LINES,
  LOGO_WIDTH,
} from './logo-data.js';

describe('compact boot logo', () => {
  it('keeps one aligned mark while using substantially less terminal space', () => {
    expect(COMPACT_LOGO_LINES.length).toBeLessThan(LOGO_LINES.length);
    expect(COMPACT_LOGO_WIDTH).toBeLessThan(LOGO_WIDTH);
    expect(COMPACT_LOGO_LINES.every((line) => line.length === COMPACT_LOGO_WIDTH)).toBe(true);
    expect(COMPACT_LOGO_LINES.some((line) => line.includes('@@@@'))).toBe(true);
  });
});

describe('terminal mark', () => {
  // The mark is a face: two lit eyes in a dark visor, wrapped in the ribbon.
  // A row through the eyes reads ribbon, visor, eye, visor, eye, visor, ribbon.
  const eyeRow = /\S\s{2,}@+\s+@+\s{2,}\S/;

  it.each([
    ['full', LOGO_LINES],
    ['compact', COMPACT_LOGO_LINES],
  ])('%s art shows both eyes inside the visor', (_name, lines) => {
    expect(lines.some((line) => eyeRow.test(line))).toBe(true);
  });
});
