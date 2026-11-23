import { describe, expect, it } from 'vitest';
import { personalPlanLabel, initialsOf } from './account-identity';

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

  it('uses the personal plan in the signed session claim', () => {
    expect(personalPlanLabel('u:free')).toBe('Free');
    expect(personalPlanLabel('u:creator_plus')).toBe('Creator Plus');
    expect(personalPlanLabel('u:pro-monthly')).toBe('Pro Monthly');
  });

  it.each([undefined, 42, 'pro', 'u:', 'o:pro', 'u:free,o:pro'])(
    'omits the tier when there is no personal plan (%s)',
    claim => expect(personalPlanLabel(claim)).toBeNull(),
  );
});
