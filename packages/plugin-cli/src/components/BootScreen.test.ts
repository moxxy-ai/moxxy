import { describe, expect, it } from 'vitest';
import { workspaceLabel } from './BootScreen.js';

describe('BootScreen workspace presentation', () => {
  it('shows a compact, terminal-safe project name', () => {
    expect(workspaceLabel('/work/acme-api')).toBe('acme-api');
    expect(workspaceLabel('/work/unsafe\u001b[31m')).toBe('unsafe[31m');
    expect(workspaceLabel('')).toBe('current project');
  });
});
