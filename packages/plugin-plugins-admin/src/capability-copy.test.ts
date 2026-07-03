import { describe, expect, it } from 'vitest';
import {
  describeCapabilitySurface,
  summarizeCapabilitySurface,
  undeclaredToolsWarning,
} from './capability-copy.js';

describe('describeCapabilitySurface', () => {
  it('returns no rows for an empty spec', () => {
    expect(describeCapabilitySurface({})).toEqual([]);
  });

  it('renders every declared axis as a label/value row', () => {
    const rows = describeCapabilitySurface({
      fs: { read: ['$cwd/**', '/tmp/**'], write: ['/tmp/out/**'] },
      net: { mode: 'allowlist', hosts: ['api.example.com', 'cdn.example.com'] },
      env: ['HOME', 'PATH'],
      subprocess: true,
      commands: ['git', 'npm'],
      timeMs: 30_000,
      memMb: 256,
    });
    expect(rows).toEqual([
      { label: 'Read files', value: '$cwd/**, /tmp/**' },
      { label: 'Write files', value: '/tmp/out/**' },
      { label: 'Network', value: 'only these hosts: api.example.com, cdn.example.com' },
      { label: 'Environment', value: 'reads HOME, PATH' },
      { label: 'Run commands', value: 'git, npm' },
      { label: 'Time budget', value: 'up to 30s per call' },
      { label: 'Memory', value: 'up to 256 MB' },
    ]);
  });

  it('says the scary things plainly: any-host net and unrestricted exec', () => {
    const rows = describeCapabilitySurface({ net: { mode: 'any' }, subprocess: true });
    expect(rows).toEqual([
      { label: 'Network', value: 'any host (unrestricted)' },
      { label: 'Run commands', value: 'any command' },
    ]);
  });

  it('renders net mode none as an explicit reassurance, not silence', () => {
    expect(describeCapabilitySurface({ net: { mode: 'none' } })).toEqual([
      { label: 'Network', value: 'no network access' },
    ]);
  });

  it('keeps sub-second time budgets in milliseconds', () => {
    expect(describeCapabilitySurface({ timeMs: 750 })).toEqual([
      { label: 'Time budget', value: 'up to 750ms per call' },
    ]);
  });
});

describe('summarizeCapabilitySurface', () => {
  it('joins rows into one compact line', () => {
    expect(
      summarizeCapabilitySurface({ fs: { read: ['$cwd/**'] }, net: { mode: 'any' } }),
    ).toBe('read files: $cwd/** · network: any host (unrestricted)');
  });

  it('is explicit when nothing is declared', () => {
    expect(summarizeCapabilitySurface({})).toBe('declares no capabilities');
  });
});

describe('undeclaredToolsWarning', () => {
  it('calls out unknown-surface tools loudly, with correct plurals', () => {
    expect(undeclaredToolsWarning(2, 5)).toBe(
      '2 of 5 tools declare NO capabilities — their surface is unknown, not empty.',
    );
    expect(undeclaredToolsWarning(1, 1)).toBe(
      '1 of 1 tool declares NO capabilities — their surface is unknown, not empty.',
    );
  });
});
