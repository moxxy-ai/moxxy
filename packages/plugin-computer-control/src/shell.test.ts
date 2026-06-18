import { MoxxyError } from '@moxxy/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureDarwin, runProcess } from './shell.js';

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
  });

  it('kills the child when timeoutMs elapses', async () => {
    const script = 'setTimeout(() => {}, 60_000);';
    const res = await runProcess(process.execPath, ['-e', script], { timeoutMs: 100 });
    expect(res.exitCode).toBe(-1);
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
