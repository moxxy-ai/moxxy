import { describe, expect, it } from 'vitest';
import { migrateModeName, isSelectableMode } from './mode.js';

describe('isSelectableMode', () => {
  it('treats a plain mode (no `special`) as selectable', () => {
    expect(isSelectableMode({ special: undefined })).toBe(true);
    expect(isSelectableMode({})).toBe(true);
  });
  it('treats a special mode as NOT selectable (any descriptor, even empty)', () => {
    expect(isSelectableMode({ special: {} })).toBe(false);
    expect(isSelectableMode({ special: { invokedBy: 'collab' } })).toBe(false);
  });
  it('filters special modes out of a list, keeping plain ones', () => {
    const modes = [
      { name: 'default' },
      { name: 'goal' },
      { name: 'collaborative', special: { invokedBy: 'collab' } },
    ];
    expect(modes.filter(isSelectableMode).map((m) => m.name)).toEqual(['default', 'goal']);
  });
});

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

  it('never leaks an inherited Object.prototype member for a polluting name', () => {
    // `name` is externally-sourced; a bare object index would resolve these to
    // truthy Functions and break the `string` contract. Each must pass through
    // as its own identity string instead.
    for (const polluting of [
      'toString',
      'valueOf',
      'constructor',
      'hasOwnProperty',
      'isPrototypeOf',
      '__proto__',
    ]) {
      const result = migrateModeName(polluting);
      expect(typeof result).toBe('string');
      expect(result).toBe(polluting);
    }
  });
});
