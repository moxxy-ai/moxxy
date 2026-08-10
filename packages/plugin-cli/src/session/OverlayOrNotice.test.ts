import { describe, expect, it } from 'vitest';
import { noticeTone } from './OverlayOrNotice.js';

describe('SystemNotice presentation', () => {
  it('uses explicit language cues to choose an accent', () => {
    expect(noticeTone('started a new run')).toBe('positive');
    expect(noticeTone('failed to list runs')).toBe('danger');
    expect(noticeTone('Everyday commands')).toBe('neutral');
  });
});
