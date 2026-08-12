import { describe, expect, it } from 'vitest';
import { shimmerBandSlices, shimmerSlices } from './ShimmerText.js';

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

  it('preserves the moving window across the gray-black-gray band', () => {
    const band = shimmerBandSlices('abcdefghi');
    expect(band).toEqual({ leading: 'abc', core: 'def', trailing: 'ghi' });
    expect(band.leading + band.core + band.trailing).toBe('abcdefghi');
    expect(shimmerBandSlices('x')).toEqual({ leading: '', core: 'x', trailing: '' });
  });
});
