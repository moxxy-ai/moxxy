import { describe, expect, it } from 'vitest';
import { runProcess } from './shell.js';

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
