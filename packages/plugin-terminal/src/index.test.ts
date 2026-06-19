import { describe, expect, it, vi } from 'vitest';
import { terminalPlugin } from './index.js';
import { buildTerminalSurface, closeAllTerminals, getSharedTerminal } from './terminal.js';
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

  // MEDIUM: a create in flight when closeAllTerminals runs must NOT strand a
  // live shell — the create continuation kills it instead of storing an orphan.
  it('kills a shell whose create resolves after closeAllTerminals', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let killed = false;
    const create = async (): Promise<TerminalProcess> => {
      await gate; // hold the create open across the shutdown
      return {
        backend: 'pipe',
        ptyError: null,
        onData: () => () => {},
        onExit: () => () => {},
        scrollback: () => '',
        write: () => {},
        resize: () => {},
        kill: () => {
          killed = true;
        },
        alive: true,
      };
    };

    const cwd = `/tmp/shutdown-${Math.random()}`;
    const p = getSharedTerminal(cwd, create); // create is now in flight
    closeAllTerminals(); // shutdown lands before the create resolves
    release(); // create finally resolves
    const proc = await p;

    expect(killed).toBe(true);
    expect(proc.kill).toBeDefined();
  });

  // u112-5: the surface's viewer fan-out must isolate a throwing viewer so it
  // does not abort delivery to the other viewers (matches pty.ts emitData).
  it('surface emit() isolates a throwing viewer from the others', async () => {
    // Capture the data callback the surface registers on the shared process so
    // the test can drive a frame through the real emit() loop.
    let pushData: ((d: string) => void) | undefined;
    const create = async (): Promise<TerminalProcess> => ({
      backend: 'pipe',
      onData: (cb) => {
        pushData = cb;
        return () => {};
      },
      onExit: () => () => {},
      scrollback: () => '',
      write: () => {},
      resize: () => {},
      kill: () => {},
      alive: true,
    });

    const cwd = `/tmp/emit-${Math.random()}`;
    // Pre-seed the shared map so the surface's getSharedTerminal(ctx.cwd) reuses
    // this fake (no real PTY spawn).
    await getSharedTerminal(cwd, create);

    const surface = buildTerminalSurface();
    const instance = await surface.open({ cwd });

    const second = vi.fn();
    instance.onData(() => {
      throw new Error('bad viewer');
    });
    instance.onData(second);

    // Drive a frame; the shared process relays it through the surface's emit().
    expect(() => pushData?.('hello')).not.toThrow();
    expect(second).toHaveBeenCalledWith({ type: 'data', data: 'hello' });
  });
});
