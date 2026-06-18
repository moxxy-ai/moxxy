import { describe, expect, it } from 'vitest';
import { badParams, SidecarError } from './types.js';

/**
 * `SidecarError` is the typed carrier that lets `dispatch` map a thrown error
 * onto the wire reply's `error.kind` without the old untyped `(e as Error &
 * { kind? }).kind = …` double-cast. These cover the carrier itself; the mapping
 * is exercised end-to-end in dispatch.test.ts.
 */
describe('SidecarError carrier', () => {
  it('is a real Error carrying message + kind', () => {
    const err = new SidecarError('boom', 'init');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SidecarError);
    expect(err.message).toBe('boom');
    expect(err.kind).toBe('init');
    expect(err.name).toBe('SidecarError');
  });

  it('badParams produces a runtime-kind SidecarError', () => {
    const err = badParams('selector is required');
    expect(err).toBeInstanceOf(SidecarError);
    expect(err.message).toBe('selector is required');
    expect(err.kind).toBe('runtime');
  });
});
