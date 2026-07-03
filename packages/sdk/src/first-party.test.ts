import { describe, expect, it } from 'vitest';
import { FIRST_PARTY_PLUGIN_SCOPE, isFirstPartyPackage } from './first-party.js';

describe('isFirstPartyPackage (third-party detection)', () => {
  it('accepts packages under the @moxxy scope', () => {
    expect(isFirstPartyPackage('@moxxy/plugin-channel-slack')).toBe(true);
    expect(isFirstPartyPackage('@moxxy/sdk')).toBe(true);
  });

  it('rejects bare (unscoped) packages', () => {
    expect(isFirstPartyPackage('left-pad')).toBe(false);
    expect(isFirstPartyPackage('moxxy-plugin-evil')).toBe(false);
  });

  it('rejects other scopes, including lookalikes', () => {
    expect(isFirstPartyPackage('@moxxyy/plugin-x')).toBe(false);
    expect(isFirstPartyPackage('@moxxy-plugins/x')).toBe(false);
    expect(isFirstPartyPackage('@evil/moxxy')).toBe(false);
  });

  it('rejects a scope-only prefix trick (@moxxy without the slash)', () => {
    // `@moxxy` alone is not under the scope: the slash is part of the prefix.
    expect(FIRST_PARTY_PLUGIN_SCOPE.endsWith('/')).toBe(true);
    expect(isFirstPartyPackage('@moxxy')).toBe(false);
  });
});
