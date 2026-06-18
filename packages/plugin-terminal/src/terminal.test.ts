import { describe, expect, it, vi } from 'vitest';
import { runCommand } from './terminal.js';
import type { TerminalProcess } from './pty.js';

/** A fake shared terminal whose data stream we drive by hand. `feed` lets a
 *  test emit chunks; `write` is a no-op (the command/sentinel are echoed by the
 *  test itself, not a real shell). */
function fakeTerminal(): TerminalProcess & { feed(s: string): void } {
  let listener: ((d: string) => void) | null = null;
  return {
    backend: 'pipe',
    ptyError: null,
    onData: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    onExit: () => () => {},
    scrollback: () => '',
    write: () => {},
    resize: () => {},
    kill: () => {},
    alive: true,
    feed: (s: string) => listener?.(s),
  };
}

describe('runCommand sentinel detection (tail-scan, single RegExp compile)', () => {
  it('completes when the sentinel arrives after many small chunks', async () => {
    const term = fakeTerminal();
    const marker = '__MOXXY_DONE_abc_0__';
    const p = runCommand(term, 'echo hi', marker, 5_000);

    // Stream a lot of output in tiny chunks (the O(n^2) re-scan path), then the
    // sentinel on its own line with exit code 0.
    for (let i = 0; i < 2000; i += 1) term.feed(`line ${i}\n`);
    term.feed(`${marker} 0\n`);

    const res = await p;
    expect(res.timedOut).toBe(false);
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('line 0');
    expect(res.output).toContain('line 1999');
    expect(res.output).not.toContain(marker);
  });

  it('detects a sentinel split across two chunks (carry-over window)', async () => {
    const term = fakeTerminal();
    const marker = '__MOXXY_DONE_xyz_1__';
    const p = runCommand(term, 'false', marker, 5_000);

    term.feed('some output\n');
    // Split the sentinel right in the middle of the marker AND the exit code.
    const sentinel = `${marker} 42\n`;
    const cut = marker.length - 3;
    term.feed(sentinel.slice(0, cut));
    term.feed(sentinel.slice(cut));

    const res = await p;
    expect(res.exitCode).toBe(42);
    expect(res.timedOut).toBe(false);
  });

  it('does not false-trigger on the echoed command line containing $?', async () => {
    const term = fakeTerminal();
    const marker = '__MOXXY_DONE_q_2__';
    const p = runCommand(term, 'echo done', marker, 5_000);

    // The shell echoes the printf command itself first (contains the marker but
    // NOT "<marker> <digits>"), then later the real sentinel value line.
    term.feed(`printf '%s %s\\n' "${marker}" "$?"\n`);
    term.feed('echo done\n');
    term.feed('done\n');
    term.feed(`${marker} 0\n`);

    const res = await p;
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe('done');
  });

  it('times out without a sentinel and reports timedOut', async () => {
    vi.useFakeTimers();
    try {
      const term = fakeTerminal();
      const p = runCommand(term, 'sleep 9', '__MOXXY_DONE_t_3__', 100);
      term.feed('partial output\n');
      vi.advanceTimersByTime(100);
      const res = await p;
      expect(res.timedOut).toBe(true);
      expect(res.exitCode).toBeNull();
      expect(res.output).toContain('partial output');
    } finally {
      vi.useRealTimers();
    }
  });
});
