import { describe, expect, it, vi } from 'vitest';
import { runCommand } from './terminal.js';
import type { TerminalProcess } from './pty.js';

/** A fake shared terminal whose data stream we drive by hand. `feed` lets a
 *  test emit chunks; `exit` fires the exit listeners; `writes` records every
 *  write so a test can assert serialization / non-interleaving. */
function fakeTerminal(): TerminalProcess & {
  feed(s: string): void;
  exit(code: number): void;
  writes: string[];
} {
  const dataListeners = new Set<(d: string) => void>();
  const exitListeners = new Set<(c: number) => void>();
  const writes: string[] = [];
  return {
    backend: 'pipe',
    ptyError: null,
    onData: (cb) => {
      dataListeners.add(cb);
      return () => dataListeners.delete(cb);
    },
    onExit: (cb) => {
      exitListeners.add(cb);
      return () => exitListeners.delete(cb);
    },
    scrollback: () => '',
    write: (d: string) => {
      writes.push(d);
    },
    resize: () => {},
    kill: () => {},
    alive: true,
    feed: (s: string) => {
      for (const cb of [...dataListeners]) cb(s);
    },
    exit: (code: number) => {
      for (const cb of [...exitListeners]) cb(code);
    },
    writes,
  };
}

/** Drain microtasks until `cond` holds. The serialized command's deferred write
 *  fires on a microtask after the prior tail resolves, so a fixed number of
 *  `await Promise.resolve()` hops flushes it deterministically (no real timers).
 *  Bounded so a genuinely-never-true condition fails the test instead of hanging. */
async function waitFor(cond: () => boolean, maxHops = 50): Promise<void> {
  for (let i = 0; i < maxHops; i += 1) {
    if (cond()) return;
    await Promise.resolve();
  }
  if (!cond()) throw new Error('waitFor: condition not met within microtask budget');
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

  // HIGH: a flood of output before the sentinel must NOT grow the accumulator
  // unbounded (OOM vector). The sentinel still detects at the tail.
  it('bounds the accumulator while still detecting a trailing sentinel', async () => {
    const term = fakeTerminal();
    const marker = '__MOXXY_DONE_flood_0__';
    const p = runCommand(term, 'yes', marker, 5_000);

    // ~5MB of output in big chunks — far past the 1MB cap.
    const big = 'A'.repeat(100_000) + '\n';
    for (let i = 0; i < 50; i += 1) term.feed(big);
    term.feed(`${marker} 0\n`);

    const res = await p;
    expect(res.timedOut).toBe(false);
    expect(res.exitCode).toBe(0);
    // The returned output is the bounded tail, not the full ~5MB.
    expect(res.output.length).toBeLessThanOrEqual(1_000_000);
    expect(res.output).not.toContain(marker);
  });

  // MEDIUM: command OUTPUT that merely CONTAINS the marker string (a printed
  // transcript, a grep hit) must not false-trigger completion — only the
  // printf's own line, anchored to a newline, ends the command.
  it('does not complete on marker text embedded mid-line in output', async () => {
    vi.useFakeTimers();
    try {
      const term = fakeTerminal();
      const marker = '__MOXXY_DONE_spoof_0__';
      const p = runCommand(term, 'cat transcript', marker, 100);

      // Hostile output: the literal "<marker> 137" but NOT on its own line.
      term.feed(`prefix ${marker} 137 suffix\n`);
      // Still no real sentinel → must time out, not report exitCode 137.
      vi.advanceTimersByTime(100);
      const res = await p;
      expect(res.timedOut).toBe(true);
      expect(res.exitCode).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // MEDIUM: a dead shell must end the command promptly with the shell's exit
  // code instead of hanging to the full timeout.
  it('finishes immediately when the shared shell exits before the sentinel', async () => {
    const term = fakeTerminal();
    const p = runCommand(term, 'sleep 100', '__MOXXY_DONE_exit_0__', 600_000);
    term.feed('starting...\n');
    term.exit(143); // user typed `exit` / shell was killed
    const res = await p;
    expect(res.timedOut).toBe(false);
    expect(res.exitCode).toBe(143);
    expect(res.output).toContain('starting...');
  });

  // HIGH: two concurrent runCommand calls on the SAME shared shell must not
  // interleave their writes on the single stdin. Command 2's writes are gated on
  // command 1's tail, so they fire a microtask AFTER command 1 resolves — asserting
  // `term.writes` synchronously after `await p1` is too early (the deferred
  // `startWrites.then(writeAndArm)` hasn't run yet). Instead we await BOTH commands
  // to completion and assert the RECORDED write order proves serialization.
  it('serializes concurrent commands on one shell (no interleaved writes)', async () => {
    const term = fakeTerminal();
    const m1 = '__MOXXY_DONE_a_0__';
    const m2 = '__MOXXY_DONE_b_0__';
    const p1 = runCommand(term, 'first', m1, 5_000);
    const p2 = runCommand(term, 'second', m2, 5_000);

    // The first command (idle shell) writes synchronously; the second waits its
    // turn behind command 1's tail and has written nothing yet.
    expect(term.writes.join('')).toContain('first\n');
    expect(term.writes.join('')).not.toContain('second\n');

    // Complete the first. `await p1` resumes before command 2's deferred write
    // has flushed, so we drive command 2 to completion too and assert afterwards.
    term.feed(`${m1} 0\n`);
    const r1 = await p1;
    expect(r1.exitCode).toBe(0);

    // Command 2's write fires on a microtask after p1 resolves; let the queue
    // drain so its command-line lands, then feed its sentinel and await it.
    await waitFor(() => term.writes.join('').includes('second\n'));
    term.feed(`${m2} 5\n`);
    const r2 = await p2;
    expect(r2.exitCode).toBe(5);

    // Serialization proof: command 2 wrote nothing until command 1 had fully
    // written — 'first\n' precedes 'second\n', and the sentinel printf that
    // captures command 1's `$?` precedes command 2's command line (no interleave).
    const all = term.writes.join('');
    const firstAt = all.indexOf('first\n');
    const secondAt = all.indexOf('second\n');
    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(secondAt).toBeGreaterThan(firstAt);
    expect(all.indexOf(`"${m1}" "$?"`)).toBeLessThan(secondAt);
  });

  // LOW: a multi-line command's echoed lines are all stripped from the output.
  it('strips every echoed line of a multi-line command', async () => {
    const term = fakeTerminal();
    const marker = '__MOXXY_DONE_ml_0__';
    const command = 'echo one\necho two';
    const p = runCommand(term, command, marker, 5_000);

    // The PTY echoes each command line separately, then the real output + sentinel.
    term.feed('echo one\n');
    term.feed('echo two\n');
    term.feed('one\n');
    term.feed('two\n');
    term.feed(`${marker} 0\n`);

    const res = await p;
    expect(res.output).toBe('one\ntwo');
  });
});
