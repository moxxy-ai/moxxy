import { describe, expect, it } from 'vitest';
import { assertInstallAllowed, isInstallPolicy, INSTALL_POLICIES } from './install-policy.js';

describe('assertInstallAllowed', () => {
  it('lets anything through under the default policy', () => {
    expect(() => assertInstallAllowed({ policy: 'open', spec: 'left-pad', signed: false })).not.toThrow();
  });

  it('refuses everything under denied, signed or not', () => {
    for (const signed of [true, false]) {
      expect(() => assertInstallAllowed({ policy: 'denied', spec: '@moxxy/plugin-memory', signed }))
        .toThrow(/disabled on this machine/);
    }
  });

  it('under registry-only, accepts a signed spec and refuses an unsigned one', () => {
    expect(() => assertInstallAllowed({ policy: 'registry-only', spec: '@moxxy/plugin-memory', signed: true }))
      .not.toThrow();
    expect(() => assertInstallAllowed({ policy: 'registry-only', spec: 'sketchy-pkg', signed: false }))
      .toThrow(/not in the signed plugin registry/);
  });

  // A developer hitting a managed restriction has to learn that a POLICY
  // exists, not just that something refused, or the next thing they try is to
  // work around it.
  it('names the policy and offers the way forward', () => {
    try {
      assertInstallAllowed({ policy: 'registry-only', spec: 'sketchy-pkg', signed: false });
      expect.unreachable();
    } catch (err) {
      const e = err as { message: string; hint?: string; context?: Record<string, unknown> };
      expect(e.message).toContain('installPolicy: registry-only');
      expect(e.hint).toContain('operator');
      expect(e.context?.spec).toBe('sketchy-pkg');
    }
  });
});

describe('isInstallPolicy', () => {
  it('accepts exactly the known policies', () => {
    for (const p of INSTALL_POLICIES) expect(isInstallPolicy(p)).toBe(true);
    for (const bad of ['', 'OPEN', 'allow', 42, null, undefined]) expect(isInstallPolicy(bad)).toBe(false);
  });
});
