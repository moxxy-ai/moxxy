import { describe, it, expect } from 'vitest';
import type { MoxxyConfig, PolicySourceRecord } from '@moxxy/config';
import { buildPolicyDoctorCheck } from './doctor.js';

const cfg = (over: Partial<MoxxyConfig> = {}): MoxxyConfig => over as MoxxyConfig;

const source = (over: Partial<PolicySourceRecord> = {}): PolicySourceRecord => ({
  id: 'corp',
  revision: 'r1',
  url: 'https://policy.example/corp.json',
  from: 'remote',
  ...over,
});

describe('buildPolicyDoctorCheck', () => {
  it('names the bundle and revision in force', () => {
    const check = buildPolicyDoctorCheck(
      cfg({ policy: { bundles: [{ id: 'corp', url: 'u', publicKey: 'k' }] } } as Partial<MoxxyConfig>),
      [source()],
    );

    expect(check.status).toBe('ok');
    expect(check.message).toContain('corp@r1');
  });

  it('warns when a bundle is serving off its cache', () => {
    // The rules still apply, but this host is not demonstrably current, and an
    // ok row would let the two be conflated.
    const check = buildPolicyDoctorCheck(
      cfg({ policy: { bundles: [{ id: 'corp', url: 'u', publicKey: 'k' }] } } as Partial<MoxxyConfig>),
      [source({ from: 'cache', staleReason: 'http 503' })],
    );

    expect(check.status).toBe('warn');
    expect(check.message).toContain('503');
  });

  it('counts local managed rules when no bundle is configured', () => {
    const check = buildPolicyDoctorCheck(
      cfg({ permissions: { deny: [{ name: 'Bash' }, { name: 'Write' }] } } as Partial<MoxxyConfig>),
      [],
    );

    expect(check.status).toBe('ok');
    expect(check.message).toContain('2 managed rule');
  });

  it('says so plainly when nothing is managed at all', () => {
    const check = buildPolicyDoctorCheck(cfg(), []);

    expect(check).toEqual({ id: 'policy', status: 'ok', message: 'no managed rules' });
  });
});
