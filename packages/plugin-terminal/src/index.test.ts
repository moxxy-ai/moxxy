import { describe, expect, it, vi } from 'vitest';
import { terminalPlugin } from './index.js';
import { getSharedTerminal } from './terminal.js';
import type { TerminalProcess } from './pty.js';

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

  it('getSharedTerminal does not spawn a duplicate PTY under a concurrent create', async () => {
    let spawns = 0;
    // A factory that yields the event loop before resolving — reproducing the
    // create race where two callers both miss the map before either set()s.
    const create = vi.fn(async (): Promise<TerminalProcess> => {
      spawns++;
      await Promise.resolve();
      const proc: TerminalProcess = {
        backend: 'pipe',
        onData: () => () => {},
        onExit: () => () => {},
        scrollback: () => '',
        write: () => {},
        resize: () => {},
        kill: () => {},
        alive: true,
      };
      return proc;
    });

    const cwd = `/tmp/race-${Math.random()}`;
    const [a, b] = await Promise.all([
      getSharedTerminal(cwd, create),
      getSharedTerminal(cwd, create),
    ]);

    expect(a).toBe(b);
    expect(spawns).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
