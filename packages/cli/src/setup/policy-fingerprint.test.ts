import { describe, it, expect } from 'vitest';
import type { MoxxyConfig } from '@moxxy/config';
import { policySummary, policyFingerprint } from './policy-fingerprint.js';

const cfg = (over: Partial<MoxxyConfig> = {}): MoxxyConfig => over as MoxxyConfig;

describe('policySummary', () => {
  it('reports effective defaults, not the literal absence of a key', () => {
    const s = policySummary(cfg());

    expect(s.securityEnabled).toBe(false);
    expect(s.thirdPartyRequireDeclaration).toBe('warn');
    expect(s.isolator).toBe('inproc');
    expect(s.allowExecutableConfig).toBe(true);
    expect(s.installPolicy).toBe('open');
  });

  it('records rule counts rather than the rules, which can name internal paths', () => {
    const s = policySummary(
      cfg({
        permissions: {
          allow: [{ name: 'Read' }],
          deny: [{ name: 'Bash' }, { name: 'Write' }],
        },
      } as Partial<MoxxyConfig>),
    );

    expect(s.managedAllowRules).toBe(1);
    expect(s.managedDenyRules).toBe(2);
    expect(JSON.stringify(s)).not.toContain('Bash');
  });

  it('records that egress is pinned, not where it points', () => {
    const pinned = policySummary(cfg({ network: { proxy: 'http://u:p@proxy.corp:3128' } } as Partial<MoxxyConfig>));

    expect(pinned.proxyPinned).toBe(true);
    expect(JSON.stringify(pinned)).not.toContain('proxy.corp');
    expect(policySummary(cfg({ network: { proxy: 'env' } } as Partial<MoxxyConfig>)).proxyPinned).toBe(false);
    expect(policySummary(cfg({ network: { proxy: 'off' } } as Partial<MoxxyConfig>)).proxyPinned).toBe(false);
  });
});

describe('policyFingerprint', () => {
  it('is stable across key insertion order, so a round-tripped summary still matches', () => {
    const a = policySummary(cfg({ security: { enabled: true }, audit: { enabled: true } } as Partial<MoxxyConfig>));
    // A summary that reached us through some other path: a JSON round-trip, a
    // remote sink, a caller that spread the fields in its own order. Same
    // policy, different insertion order, and the fingerprint has to agree or
    // comparing two runs stops meaning anything.
    const reordered = Object.fromEntries(
      Object.entries(a).reverse(),
    ) as unknown as typeof a;

    expect(Object.keys(reordered)).not.toEqual(Object.keys(a));
    expect(policyFingerprint(reordered)).toBe(policyFingerprint(a));
  });

  it('changes when a setting that decides what the agent may do changes', () => {
    const base = policyFingerprint(policySummary(cfg()));

    const differs = [
      cfg({ security: { enabled: true } } as Partial<MoxxyConfig>),
      cfg({ config: { allowExecutable: false } } as Partial<MoxxyConfig>),
      cfg({ plugins: { installPolicy: 'registry-only' } } as Partial<MoxxyConfig>),
      cfg({ plugins: { isolator: { default: 'subprocess' } } } as Partial<MoxxyConfig>),
      cfg({ permissions: { deny: [{ name: 'Bash' }] } } as Partial<MoxxyConfig>),
    ];

    for (const c of differs) {
      expect(policyFingerprint(policySummary(c))).not.toBe(base);
    }
  });

  it('does not churn on preferences that cannot affect what was permitted', () => {
    const base = policyFingerprint(policySummary(cfg()));
    const withPrefs = policySummary(
      cfg({ model: 'some-other-model', theme: 'dark' } as unknown as Partial<MoxxyConfig>),
    );

    expect(policyFingerprint(withPrefs)).toBe(base);
  });
});
