import { MoxxyError } from '@moxxy/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureDarwin, MAX_OUTPUT_BYTES, procFailureCause, runProcess } from './shell.js';

describe('runProcess stdout capture (chunked, O(n) concat-at-close)', () => {
  it('captures the full stdout across many small chunks', async () => {
    // A child that writes 5000 lines one at a time — exercises the multi-chunk
    // 'data' path that used to re-copy the whole buffer per event.
    const script =
      "for (let i = 0; i < 5000; i++) { process.stdout.write('line ' + i + '\\n'); }";
    const res = await runProcess(process.execPath, ['-e', script], { timeoutMs: 30_000 });

    expect(res.exitCode).toBe(0);
    const lines = res.stdout.split('\n');
    // 5000 lines + a trailing '' from the final newline.
    expect(lines).toHaveLength(5001);
    expect(lines[0]).toBe('line 0');
    expect(lines[4999]).toBe('line 4999');
    expect(lines[5000]).toBe('');
  });

  it('captures binary-ish/multibyte stdout without corrupting it', async () => {
    const script = "process.stdout.write('héllo 🦊 wörld');";
    const res = await runProcess(process.execPath, ['-e', script], { timeoutMs: 30_000 });
    expect(res.stdout).toBe('héllo 🦊 wörld');
  });

  it('writes input to stdin and reads it back', async () => {
    const script =
      "let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => process.stdout.write(s.toUpperCase()));";
    const res = await runProcess(process.execPath, ['-e', script], { input: 'hello' });
    expect(res.stdout).toBe('HELLO');
  });

  it('does not crash (EPIPE) when the child exits before stdin is fully written', async () => {
    // The child exits immediately WITHOUT reading stdin; writing a large
    // buffer to its closed stdin pipe emits 'error' (EPIPE) on the Writable.
    // With no 'error' listener that throws as an unhandled rejection that can
    // take down the parent — the swallow handler must keep us alive.
    const big = 'x'.repeat(2 * 1024 * 1024);
    const res = await runProcess(process.execPath, ['-e', 'process.exit(0)'], {
      input: big,
      timeoutMs: 30_000,
    });
    // We don't assert on stdout here — only that the call settles without an
    // uncaught EPIPE. The child's own exit code is what matters.
    expect(res.exitCode).toBe(0);
  });
});

describe('runProcess exit/stderr/abort/timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures stderr and maps a non-zero exit code', async () => {
    const script = "process.stderr.write('boom'); process.exit(3);";
    const res = await runProcess(process.execPath, ['-e', script], { timeoutMs: 30_000 });
    expect(res.exitCode).toBe(3);
    expect(res.stderr).toBe('boom');
    expect(res.stdout).toBe('');
    // A genuine non-zero exit is neither a timeout nor an abort.
    expect(res.timedOut).toBe(false);
    expect(res.aborted).toBe(false);
    expect(procFailureCause(res, 30_000)).toBe('');
  });

  it('captures multibyte stderr without corruption (chunk-boundary safe)', async () => {
    // A flood of 3-byte glyphs forces the stream to split a UTF-8 sequence
    // mid-character across 'data' chunk boundaries (the ~8 KB pipe chunk size
    // is not a multiple of 3, so a boundary lands inside a glyph). Decoding
    // each chunk in isolation — the pre-fix behavior — emits replacement chars
    // (U+FFFD); concat-at-close preserves the exact bytes. This matters for
    // osascript/sips error text with non-ASCII app names.
    // Exit only AFTER the write fully drains so the pipe isn't truncated by a
    // premature process.exit (a harness artifact, not the behavior under test).
    const count = 20000;
    const script = `process.stderr.write('世'.repeat(${count}), () => process.exit(1));`;
    const res = await runProcess(process.execPath, ['-e', script], { timeoutMs: 30_000 });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('世'.repeat(count));
    expect(res.stderr).not.toContain('�');
  });

  it('does not spawn and resolves as aborted when the signal is ALREADY aborted', async () => {
    // DOM semantics: addEventListener('abort', ...) on an already-aborted
    // signal never fires — so without an up-front check a cancelled turn would
    // still run the child to completion. The child here would write a sentinel
    // and exit 0 if it ran; we assert it never did.
    const ctrl = new AbortController();
    ctrl.abort();
    const script = "process.stdout.write('SHOULD_NOT_RUN'); process.exit(0);";
    const res = await runProcess(process.execPath, ['-e', script], {
      signal: ctrl.signal,
      timeoutMs: 30_000,
    });
    expect(res.aborted).toBe(true);
    expect(res.stdout).toBe('');
    expect(res.exitCode).toBe(-1);
    expect(res.timedOut).toBe(false);
    expect(res.tooLarge).toBe(false);
    expect(procFailureCause(res)).toBe('aborted (turn cancelled)');
  });

  it('rejects when the binary does not exist (spawn error)', async () => {
    await expect(
      runProcess('definitely-not-a-real-binary-xyz', [], { timeoutMs: 30_000 }),
    ).rejects.toThrow();
  });

  it('kills the child when the AbortSignal fires', async () => {
    const ctrl = new AbortController();
    // A child that would otherwise run for a long time.
    const script = 'setTimeout(() => {}, 60_000);';
    const promise = runProcess(process.execPath, ['-e', script], { signal: ctrl.signal });
    // Give the child a tick to spawn, then abort.
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    const res = await promise;
    // SIGTERM-killed child resolves via 'close' with a null code -> -1.
    expect(res.exitCode).toBe(-1);
    // ...but the `aborted` flag distinguishes it from a genuine -1 exit.
    expect(res.aborted).toBe(true);
    expect(res.timedOut).toBe(false);
    expect(procFailureCause(res)).toBe('aborted (turn cancelled)');
  });

  it('kills the child when timeoutMs elapses', async () => {
    const script = 'setTimeout(() => {}, 60_000);';
    const res = await runProcess(process.execPath, ['-e', script], { timeoutMs: 100 });
    expect(res.exitCode).toBe(-1);
    // A timed-out child is flagged so callers can report a precise cause
    // rather than a confusing bare `exit -1`.
    expect(res.timedOut).toBe(true);
    expect(res.aborted).toBe(false);
    expect(res.tooLarge).toBe(false);
    expect(procFailureCause(res, 100)).toBe('timed out after 100ms');
  });

  it('force-kills a child that floods stdout past MAX_OUTPUT_BYTES instead of OOMing', async () => {
    // A runaway child that writes an unbounded stream. The byte cap must kill
    // it well before it can accumulate gigabytes in the parent; we cap the
    // child's own attempt above MAX_OUTPUT_BYTES so the test also terminates
    // on its own if the cap somehow fails to fire.
    const target = MAX_OUTPUT_BYTES + 4 * 1024 * 1024;
    const script = `
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      let sent = 0;
      const target = ${target};
      function pump() {
        while (sent < target) {
          sent += chunk.length;
          if (!process.stdout.write(chunk)) { process.stdout.once('drain', pump); return; }
        }
      }
      pump();
    `;
    const res = await runProcess(process.execPath, ['-e', script], { timeoutMs: 30_000 });
    expect(res.tooLarge).toBe(true);
    // We STOP retaining chunks the instant the cap is tripped, so the captured
    // output never exceeds the cap plus one already-buffered chunk — it does
    // NOT keep growing toward `target` while the child is being killed.
    expect(Buffer.byteLength(res.stdout, 'utf8')).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES + 1024 * 1024,
    );
    expect(res.timedOut).toBe(false);
    expect(procFailureCause(res, 30_000)).toContain('output exceeded');
  });
});

describe('ensureDarwin', () => {
  it('matches the current platform contract', () => {
    if (process.platform === 'darwin') {
      expect(() => ensureDarwin('screenshot')).not.toThrow();
    } else {
      expect(() => ensureDarwin('screenshot')).toThrow(MoxxyError);
      try {
        ensureDarwin('screenshot');
      } catch (err) {
        expect(err).toBeInstanceOf(MoxxyError);
        expect((err as MoxxyError).code).toBe('TOOL_ERROR');
        expect((err as MoxxyError).message).toContain('screenshot');
      }
    }
  });
});
