import { describe, expect, it } from 'vitest';
import { formatTier, initialsOf } from './account-identity';

describe('account identity', () => {
  it('draws initials from a name', () => {
    expect(initialsOf('Alex Chen')).toBe('AC');
    expect(initialsOf('  Maria  de la Cruz ')).toBe('MC');
    expect(initialsOf('alex')).toBe('AL');
    expect(initialsOf('alex@example.com')).toBe('AL');
  });

  it('has no initials for no name', () => {
    expect(initialsOf('')).toBeNull();
    expect(initialsOf('   ')).toBeNull();
  });

  it('reads the tier from account metadata, defaulting to Free', () => {
    expect(formatTier('pro')).toBe('Pro');
    expect(formatTier('  TEAM ')).toBe('Team');
    expect(formatTier(undefined)).toBe('Free');
    expect(formatTier(42)).toBe('Free');
  });
});
