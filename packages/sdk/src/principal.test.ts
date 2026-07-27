import { describe, expect, it } from 'vitest';
import { formatPrincipal, samePrincipal, type Principal } from './principal.js';
import { resolveOsPrincipal } from './principal-os.js';

const alice: Principal = { id: 'alice', kind: 'human', issuer: 'os' };

describe('samePrincipal', () => {
  // An id is only unique inside its issuer's namespace. Collapsing that would
  // let a weakly-issued identity impersonate a strongly-issued one of the same
  // name, which is the whole reason `issuer` exists.
  it('requires the issuer to match, not just the id', () => {
    expect(samePrincipal(alice, { ...alice, issuer: 'oidc' })).toBe(false);
    expect(samePrincipal(alice, { ...alice, displayName: 'Alice A.' })).toBe(true);
  });

  it('treats undefined as unattributed, not as a wildcard', () => {
    expect(samePrincipal(undefined, alice)).toBe(false);
    expect(samePrincipal(alice, undefined)).toBe(false);
    expect(samePrincipal(undefined, undefined)).toBe(true);
  });
});

describe('formatPrincipal', () => {
  it('renders issuer:id, never the display name', () => {
    expect(formatPrincipal({ ...alice, displayName: 'Alice A.' })).toBe('os:alice');
  });

  it('names the absent case explicitly', () => {
    expect(formatPrincipal(undefined)).toBe('unattributed');
  });
});

describe('resolveOsPrincipal', () => {
  it('issues a human principal scoped to the host', () => {
    const p = resolveOsPrincipal();
    expect(p.kind).toBe('human');
    expect(p.issuer).toBe('os');
    expect(p.id.length).toBeGreaterThan(0);
    expect(p.displayName).toBeTruthy();
  });

  // A bare username collides the moment transcripts from several machines land
  // in one audit sink.
  it('qualifies the id with the hostname', () => {
    expect(resolveOsPrincipal().id).toContain('@');
  });
});
