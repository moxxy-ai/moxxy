import { describe, expect, it } from 'vitest';
import { shimmerSlices } from './ShimmerText.js';

describe('shimmerSlices', () => {
  it('preserves the full text while the glow crosses it', () => {
    for (let frame = 0; frame < 20; frame += 1) {
      const slices = shimmerSlices('Reading files…', frame, 4);
      expect(slices.before + slices.glow + slices.after).toBe('Reading files…');
      expect(slices.glow.length).toBeLessThanOrEqual(4);
    }
  });

  it('handles empty and short labels', () => {
    expect(shimmerSlices('', 0)).toEqual({ before: '', glow: '', after: '' });
    const short = shimmerSlices('ok', 5, 20);
    expect(short.before + short.glow + short.after).toBe('ok');
  });
});
