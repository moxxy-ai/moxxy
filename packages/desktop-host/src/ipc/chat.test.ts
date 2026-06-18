import { describe, it, expect } from 'vitest';
import { shouldMirrorToNdjson } from './chat';

describe('shouldMirrorToNdjson (double-write gate)', () => {
  it('skips the NDJSON mirror for a v10+ runner (runner is authoritative)', () => {
    expect(shouldMirrorToNdjson(10)).toBe(false);
    expect(shouldMirrorToNdjson(11)).toBe(false);
  });

  it('keeps writing the mirror against a <v10 runner (renderer still falls back to NDJSON)', () => {
    expect(shouldMirrorToNdjson(9)).toBe(true);
    expect(shouldMirrorToNdjson(7)).toBe(true);
  });

  it('keeps writing the mirror when the runner version is unknown (no runner attached yet)', () => {
    // Safe default — never drop an event because we couldn't read the version.
    expect(shouldMirrorToNdjson(null)).toBe(true);
  });
});
