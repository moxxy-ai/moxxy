import { describe, expect, it } from 'vitest';
import { migrateModeName } from './mode.js';

describe('migrateModeName', () => {
  it('maps every legacy mode name to its current target', () => {
    expect(migrateModeName('tool-use')).toBe('default');
    expect(migrateModeName('deep-research')).toBe('research');
    expect(migrateModeName('plan-execute')).toBe('default');
    expect(migrateModeName('bmad')).toBe('default');
    expect(migrateModeName('developer')).toBe('default');
  });

  it('passes a current/unknown name through unchanged (identity)', () => {
    expect(migrateModeName('default')).toBe('default');
    expect(migrateModeName('goal')).toBe('goal');
    expect(migrateModeName('research')).toBe('research');
    expect(migrateModeName('some-future-mode')).toBe('some-future-mode');
    expect(migrateModeName('')).toBe('');
  });
});
