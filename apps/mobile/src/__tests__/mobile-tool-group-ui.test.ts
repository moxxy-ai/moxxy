import { describe, expect, it } from 'vitest';
import { buildToolGroupUi } from '../toolGroupUi';

describe('mobile tool group ui', () => {
  it('surfaces running as the primary collapsed status', () => {
    expect(buildToolGroupUi([
      { id: 'ok', name: 'Read', status: 'ok', summary: '' },
      { id: 'run', name: 'Bash', status: 'running', summary: '' },
    ])).toMatchObject({
      statusLabel: 'running',
      summary: '1 ok · 1 running',
      pulse: true,
    });
  });

  it('surfaces failed status before running', () => {
    expect(buildToolGroupUi([
      { id: 'run', name: 'Read', status: 'running', summary: '' },
      { id: 'err', name: 'Bash', status: 'error', summary: '' },
    ])).toMatchObject({
      statusLabel: 'failed',
      summary: '1 failed · 1 running',
      pulse: false,
    });
  });
});
