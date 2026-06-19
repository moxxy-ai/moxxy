import { describe, expect, it } from 'vitest';
import { looksLikeMoxxyRunner } from './run-tui.js';

describe('looksLikeMoxxyRunner (kill guard)', () => {
  it('refuses non-positive / non-integer PIDs', async () => {
    expect(await looksLikeMoxxyRunner(0)).toBe(false);
    expect(await looksLikeMoxxyRunner(-1)).toBe(false);
    expect(await looksLikeMoxxyRunner(1.5)).toBe(false);
    expect(await looksLikeMoxxyRunner(Number.NaN)).toBe(false);
  });

  it('refuses a PID that is almost certainly not running (no false-positive kill target)', async () => {
    // A very high PID is overwhelmingly unlikely to exist; the guard must NOT
    // claim it's a moxxy runner (which would authorize a SIGKILL).
    expect(await looksLikeMoxxyRunner(2_000_000_000)).toBe(false);
  });

  it('does not match the test runner process itself (not a moxxy runner)', async () => {
    // The vitest/node process command line contains no "moxxy"/"serve", so the
    // guard must return false — confirming it does not blanket-approve any live
    // PID just because the process exists.
    expect(await looksLikeMoxxyRunner(process.pid)).toBe(false);
  });
});
