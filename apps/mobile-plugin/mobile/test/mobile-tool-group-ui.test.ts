import { describe, expect, it } from 'vitest';
import { buildToolDetailUi, buildToolGroupUi } from '../src/toolGroupUi';

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

  it('builds expandable detail copy for a completed main-agent tool', () => {
    expect(buildToolDetailUi({
      id: 'fetch-1',
      name: 'web_fetch',
      status: 'ok',
      summary: 'url: https://example.com',
      resultSummary: 'HTTP 200 Example Domain',
    })).toEqual({
      id: 'fetch-1',
      name: 'web_fetch',
      statusLabel: 'ok',
      statusTone: 'ok',
      summary: 'url: https://example.com',
      detailLabel: 'Result',
      detail: 'HTTP 200 Example Domain',
    });
  });

  it('builds expandable detail copy for a failed tool', () => {
    expect(buildToolDetailUi({
      id: 'click-1',
      name: 'computer_click',
      status: 'error',
      summary: 'x: 12 · y: 24',
      error: 'System Events error -25208',
    })).toEqual({
      id: 'click-1',
      name: 'computer_click',
      statusLabel: 'failed',
      statusTone: 'error',
      summary: 'x: 12 · y: 24',
      detailLabel: 'Error',
      detail: 'System Events error -25208',
    });
  });
});
