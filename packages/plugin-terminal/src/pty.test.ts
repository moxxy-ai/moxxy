import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeExecutable, resolveNodePtyModule, TerminalProcessImpl } from './pty.js';

const MAX_SCROLLBACK = 200_000;

/** A minimal stand-in for the piped child the impl wires its stdout listeners
 *  onto, so we can feed `emitData` without spawning a real shell. */
type FakeStdin = EventEmitter & { write(d?: string): void; end(): void };
function fakeChild(stdinWrite?: (d?: string) => void): {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: FakeStdin;
  proc: EventEmitter & { stdin: FakeStdin };
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: FakeStdin;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeStdin;
  stdin.write = stdinWrite ?? (() => {});
  stdin.end = () => {};
  proc.stdin = stdin;
  return { stdout: proc.stdout, stderr: proc.stderr, stdin, proc };
}

describe('resolveNodePtyModule (degrade on a malformed optional dep)', () => {
  it('accepts a namespace with a callable spawn', () => {
    const mod = { spawn: () => ({}) };
    expect(resolveNodePtyModule(mod)).toBe(mod);
  });

  it('accepts a CJS-interop module whose spawn lives on .default', () => {
    const def = { spawn: () => ({}) };
    expect(resolveNodePtyModule({ default: def })).toBe(def);
  });

  it('rejects a module whose default lacks spawn (degrade to pipe, no later throw)', () => {
    // A partially-shimmed module: a `default` object with no spawn. The old code
    // returned it and let `pty.spawn(...)` blow up with "is not a function".
    expect(resolveNodePtyModule({ default: { notSpawn: 1 } })).toBeNull();
  });

  it('rejects a non-function spawn', () => {
    expect(resolveNodePtyModule({ spawn: 'nope' })).toBeNull();
    expect(resolveNodePtyModule({ default: { spawn: 42 } })).toBeNull();
  });

  it('rejects null / undefined / primitive module shapes without throwing', () => {
    expect(resolveNodePtyModule(null)).toBeNull();
    expect(resolveNodePtyModule(undefined)).toBeNull();
    expect(resolveNodePtyModule('node-pty')).toBeNull();
    expect(resolveNodePtyModule(123)).toBeNull();
    expect(resolveNodePtyModule({})).toBeNull();
  });
});

describe('makeExecutable (node-pty spawn-helper repair)', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('adds the executable bit to a file that lacks it', () => {
    dir = mkdtempSync(join(tmpdir(), 'moxxy-pty-'));
    const file = join(dir, 'spawn-helper');
    writeFileSync(file, 'binary');
    // Simulate the stripped-bit state that breaks node-pty's posix_spawnp.
    const noExec = statSync(file).mode;
    expect(noExec & 0o111).toBe(0);

    expect(makeExecutable(file)).toBe(true);
    expect(statSync(file).mode & 0o111).not.toBe(0);
  });

  it('is idempotent on an already-executable file', () => {
    dir = mkdtempSync(join(tmpdir(), 'moxxy-pty-'));
    const file = join(dir, 'spawn-helper');
    writeFileSync(file, 'binary', { mode: 0o755 });
    expect(makeExecutable(file)).toBe(true);
    expect(statSync(file).mode & 0o111).not.toBe(0);
  });

  it('returns false (no throw) for a missing file', () => {
    expect(makeExecutable(join(tmpdir(), 'moxxy-does-not-exist', 'spawn-helper'))).toBe(false);
  });
});

describe('TerminalProcessImpl scrollback (hysteresis trim)', () => {
  it('keeps scrollback bounded to the cap and returns the true tail', () => {
    const { stdout, proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);

    // Emit far more than the cap in many small chunks (the saturated path that
    // used to copy the whole cap on every chunk).
    let written = '';
    const chunk = 'x'.repeat(1000);
    for (let i = 0; i < 500; i += 1) {
      // Mark each chunk's last char so we can verify the exact tail.
      const tagged = chunk.slice(0, -6) + i.toString().padStart(6, '0');
      written += tagged;
      stdout.emit('data', Buffer.from(tagged, 'utf8'));
    }

    const sb = term.scrollback();
    // Observable tail is exactly the last MAX_SCROLLBACK chars of all output —
    // byte-identical to the old `(buffer + d).slice(-MAX_SCROLLBACK)` semantics.
    expect(sb.length).toBe(MAX_SCROLLBACK);
    expect(sb).toBe(written.slice(-MAX_SCROLLBACK));
  });

  it('returns the whole buffer untouched while under the cap', () => {
    const { stdout, proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    stdout.emit('data', Buffer.from('hello ', 'utf8'));
    stdout.emit('data', Buffer.from('world', 'utf8'));
    expect(term.scrollback()).toBe('hello world');
  });
});

describe('TerminalProcessImpl exit lifecycle', () => {
  it('emitExit fires listeners exactly once and flips alive (idempotent)', () => {
    const { proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    const codes: number[] = [];
    term.onExit((c) => codes.push(c));
    expect(term.alive).toBe(true);

    // A real child can emit both 'exit' and 'error'; only the first must win.
    proc.emit('exit', 7);
    proc.emit('exit', 9);
    proc.emit('error', new Error('late'));

    expect(codes).toEqual([7]);
    expect(term.alive).toBe(false);
  });

  it('kill() emits exit once and is a no-op after the process already died', () => {
    const { proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    const codes: number[] = [];
    term.onExit((c) => codes.push(c));

    term.kill();
    term.kill();
    proc.emit('exit', 3); // already dead — ignored

    expect(codes).toEqual([0]);
    expect(term.alive).toBe(false);
  });

  it('a throwing data listener does not break delivery to the others', () => {
    const { stdout, proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    const seen: string[] = [];
    term.onData(() => {
      throw new Error('bad viewer');
    });
    term.onData((d) => seen.push(d));

    stdout.emit('data', Buffer.from('payload', 'utf8'));
    expect(seen).toEqual(['payload']);
    // The buffer still accumulates despite the throwing listener.
    expect(term.scrollback()).toBe('payload');
  });

  it('write() after exit is a no-op (does not throw)', () => {
    const { proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    proc.emit('exit', 0);
    expect(() => term.write('ignored')).not.toThrow();
  });

  it('write() swallows a synchronous EPIPE from a stdin pipe that closed before exit fired', () => {
    // The child has exited (stdin closed) but the async 'exit' event has not yet
    // flipped `alive` — write() must not let the broken-pipe throw escape.
    const { proc } = fakeChild(() => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    expect(term.alive).toBe(true); // exit hasn't fired yet
    expect(() => term.write('still typing')).not.toThrow();
  });

  it('an async error on stdin never goes unhandled (a no-op handler is attached)', () => {
    const { stdin, proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new TerminalProcessImpl('pipe', null, proc as any);
    // Without a registered 'error' listener, EventEmitter would re-throw here.
    expect(() => stdin.emit('error', new Error('broken pipe'))).not.toThrow();
  });

  it('unsubscribe stops further data delivery', () => {
    const { stdout, proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    const seen: string[] = [];
    const unsub = term.onData((d) => seen.push(d));
    stdout.emit('data', Buffer.from('a', 'utf8'));
    unsub();
    stdout.emit('data', Buffer.from('b', 'utf8'));
    expect(seen).toEqual(['a']);
  });
});

describe('TerminalProcessImpl kill() terminates the child process tree', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('signals the whole process GROUP (negative pid) then escalates to SIGKILL', () => {
    if (process.platform === 'win32') return; // POSIX group-kill path only
    vi.useFakeTimers();
    const { proc } = fakeChild();
    // Give the fake a pid + a kill so the group-signal path is exercised.
    (proc as unknown as { pid: number }).pid = 4242;
    (proc as unknown as { kill: (s?: string) => boolean }).kill = () => true;

    const killed: Array<{ target: number; signal: string }> = [];
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      killed.push({ target: pid, signal: String(signal) });
      return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    term.kill();

    // SIGTERM goes to the GROUP: negative pid.
    expect(killed).toContainEqual({ target: -4242, signal: 'SIGTERM' });
    // After the grace window, SIGKILL also targets the group.
    vi.advanceTimersByTime(5_000);
    expect(killed).toContainEqual({ target: -4242, signal: 'SIGKILL' });
  });

  it('falls back to signaling just the child when the group signal fails', () => {
    if (process.platform === 'win32') return;
    vi.useFakeTimers(); // keep the escalation timer from firing real process.kill after restore
    const { proc } = fakeChild();
    (proc as unknown as { pid: number }).pid = 99;
    const childSignals: string[] = [];
    (proc as unknown as { kill: (s?: string) => boolean }).kill = (s?: string) => {
      childSignals.push(String(s));
      return true;
    };
    vi.spyOn(process, 'kill').mockImplementation((() => {
      throw new Error('ESRCH'); // no such process group
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    expect(() => term.kill()).not.toThrow();
    // Group signal threw → fell back to child.kill('SIGTERM').
    expect(childSignals).toContain('SIGTERM');
  });

  it('warns once when listeners grow past the leak threshold and never crashes', () => {
    const { proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Attach far more than the threshold (64) without ever unsubscribing — the
    // "viewer that never closed" leak the warning is meant to surface.
    for (let i = 0; i < 100; i += 1) term.onData(() => {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('listeners');
  });
});
