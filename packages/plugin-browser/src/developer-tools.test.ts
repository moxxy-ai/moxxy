import { describe, expect, it } from 'vitest';
import { buildAgentTools } from './agent-tools.js';
import { zodToJsonSchema } from '@moxxy/sdk';

describe('developer tool contracts', () => {
  it('exposes bounded diagnostics with explicit recording and response reads', () => {
    const tool = buildAgentTools().find((tool) => tool.name === 'browser_diagnostics');
    expect(tool).toBeDefined();
    if (!tool) throw new Error('diagnostics tool missing');
    expect(tool.isolation, 'required by security.requireDeclaration').toBeDefined();
    expect(tool.inputSchema.safeParse({ action: 'start' }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ action: 'read', limit: 101 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ action: 'response' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ action: 'response', request_id: '123' }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ action: 'read', headers: true }).success).toBe(false);
    expect(tool.description).toMatch(/same message/);
  });

  it('requires a complete bounded viewport or an explicit reset', () => {
    const tool = buildAgentTools().find((tool) => tool.name === 'browser_viewport');
    expect(tool).toBeDefined();
    if (!tool) throw new Error('viewport tool missing');
    expect(tool.isolation, 'required by security.requireDeclaration').toBeDefined();
    expect(zodToJsonSchema(tool.inputSchema)).toMatchObject({ type: 'object' });
    expect(tool.inputSchema.safeParse({ width: 390, height: 844 }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ width: 390 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ reset: true }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ width: 1e9, height: 844 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ reset: true, width: 390, height: 844 }).success).toBe(true);
  });
});
