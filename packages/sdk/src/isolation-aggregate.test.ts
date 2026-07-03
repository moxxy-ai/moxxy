import { describe, expect, it } from 'vitest';
import { aggregateCapabilitySpecs, type CapabilitySpec } from './isolation.js';

describe('aggregateCapabilitySpecs', () => {
  it('empty / all-undefined input aggregates to an empty surface', () => {
    expect(aggregateCapabilitySpecs([])).toEqual({});
    expect(aggregateCapabilitySpecs([undefined, undefined])).toEqual({});
  });

  it('unions fs globs, env, and commands (sorted, deduped)', () => {
    const a: CapabilitySpec = {
      fs: { read: ['$cwd/**', '/tmp/**'], write: ['/tmp/**'] },
      env: ['PATH', 'HOME'],
      subprocess: true,
      commands: ['npm'],
    };
    const b: CapabilitySpec = {
      fs: { read: ['/tmp/**'] },
      env: ['PATH'],
      subprocess: true,
      commands: ['git', 'npm'],
    };
    expect(aggregateCapabilitySpecs([a, b])).toEqual({
      fs: { read: ['$cwd/**', '/tmp/**'], write: ['/tmp/**'] },
      env: ['HOME', 'PATH'],
      subprocess: true,
      commands: ['git', 'npm'],
    });
  });

  it('net takes the strongest mode: any > allowlist > none', () => {
    const none: CapabilitySpec = { net: { mode: 'none' } };
    const list: CapabilitySpec = { net: { mode: 'allowlist', hosts: ['b.com', 'a.com'] } };
    const any: CapabilitySpec = { net: { mode: 'any' } };

    expect(aggregateCapabilitySpecs([none])).toEqual({ net: { mode: 'none' } });
    expect(aggregateCapabilitySpecs([none, list])).toEqual({
      net: { mode: 'allowlist', hosts: ['a.com', 'b.com'] },
    });
    expect(aggregateCapabilitySpecs([list, any, none])).toEqual({ net: { mode: 'any' } });
  });

  it('merges allowlist hosts across specs', () => {
    const a: CapabilitySpec = { net: { mode: 'allowlist', hosts: ['registry.npmjs.org'] } };
    const b: CapabilitySpec = { net: { mode: 'allowlist', hosts: ['api.slack.com'] } };
    expect(aggregateCapabilitySpecs([a, b])).toEqual({
      net: { mode: 'allowlist', hosts: ['api.slack.com', 'registry.npmjs.org'] },
    });
  });

  it('timeMs and memMb take the max; undeclared entries contribute nothing', () => {
    const a: CapabilitySpec = { timeMs: 30_000, memMb: 128 };
    const b: CapabilitySpec = { timeMs: 600_000 };
    expect(aggregateCapabilitySpecs([a, undefined, b])).toEqual({
      timeMs: 600_000,
      memMb: 128,
    });
  });

  it('an "any" net dropped into a wide union does not resurrect allowlist hosts', () => {
    // Regression guard: once mode is 'any', collected hosts must not leak
    // back into the result as a misleading narrower-looking allowlist.
    const spec = aggregateCapabilitySpecs([
      { net: { mode: 'allowlist', hosts: ['a.com'] } },
      { net: { mode: 'any' } },
    ]);
    expect(spec.net).toEqual({ mode: 'any' });
  });
});
