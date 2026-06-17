import { describe, expect, it } from 'vitest';
import { terminalPlugin } from './index.js';

describe('plugin-terminal', () => {
  it('contributes a terminal surface and a terminal tool', () => {
    expect(terminalPlugin.surfaces?.map((s) => s.kind)).toContain('terminal');
    expect(terminalPlugin.tools?.map((t) => t.name)).toContain('terminal');
  });

  it('terminal tool validates its input schema', () => {
    const tool = terminalPlugin.tools?.find((t) => t.name === 'terminal');
    expect(tool).toBeDefined();
    // A command is required; an empty object is rejected.
    expect(tool!.inputSchema.safeParse({ command: 'ls -la' }).success).toBe(true);
    expect(tool!.inputSchema.safeParse({}).success).toBe(false);
    // timeoutMs is bounded.
    expect(tool!.inputSchema.safeParse({ command: 'x', timeoutMs: 5000 }).success).toBe(true);
    expect(tool!.inputSchema.safeParse({ command: 'x', timeoutMs: -1 }).success).toBe(false);
  });
});
