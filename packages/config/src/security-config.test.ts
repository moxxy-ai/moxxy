import { describe, expect, it } from 'vitest';
import { moxxyConfigSchema, securityConfigSchema } from './schema.js';

describe('security.thirdPartyRequireDeclaration schema round-trip', () => {
  it.each(['off', 'warn', 'enforce'] as const)('accepts and preserves %s', (mode) => {
    const parsed = moxxyConfigSchema.parse({
      security: { enabled: true, thirdPartyRequireDeclaration: mode },
    });
    expect(parsed.security?.thirdPartyRequireDeclaration).toBe(mode);
  });

  it('stays absent when unset (consumer applies the warn default)', () => {
    const parsed = moxxyConfigSchema.parse({ security: { enabled: true } });
    expect(parsed.security?.thirdPartyRequireDeclaration).toBeUndefined();
  });

  it('rejects values outside the closed enum', () => {
    expect(() =>
      securityConfigSchema.parse({ thirdPartyRequireDeclaration: 'deny' }),
    ).toThrow();
    expect(() =>
      securityConfigSchema.parse({ thirdPartyRequireDeclaration: true }),
    ).toThrow();
  });

  it('validates as a partial block (the field alone parses)', () => {
    const parsed = securityConfigSchema.parse({ thirdPartyRequireDeclaration: 'enforce' });
    expect(parsed).toEqual({ thirdPartyRequireDeclaration: 'enforce' });
  });
});
