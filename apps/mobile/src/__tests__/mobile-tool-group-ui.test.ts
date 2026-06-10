import { describe, expect, it } from 'vitest';
import { buildToolDiagnostics, buildToolGroupUi } from '../toolGroupUi';

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

describe('mobile tool diagnostics', () => {
  it('expands a tapped tool into input, output, then error sections', () => {
    expect(buildToolDiagnostics({
      id: 't1',
      name: 'Bash',
      status: 'error',
      summary: 'command: rm',
      input: '{\n  "command": "rm"\n}',
      output: 'partial output',
      errorText: 'denied',
    })).toEqual([
      { kind: 'input', text: '{\n  "command": "rm"\n}' },
      { kind: 'output', text: 'partial output' },
      { kind: 'error', text: 'denied' },
    ]);
  });

  it('yields no sections (row not expandable) when the events carried no detail', () => {
    expect(buildToolDiagnostics({ id: 't1', name: 'Read', status: 'running', summary: '' })).toEqual([]);
  });
});
