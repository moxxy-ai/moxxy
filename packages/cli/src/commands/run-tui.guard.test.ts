import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { looksLikeMoxxyRunner, readSocketHolderPid } from './run-tui.js';

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

describe('readSocketHolderPid (bounded lsof recovery)', () => {
  it('returns null (no false PID) for a path nothing holds, and never hangs', async () => {
    // No process holds this path, so lsof exits with no output — the helper must
    // resolve null, not a bogus PID that would authorize a kill.
    const phantom = path.join(tmpdir(), `moxxy-no-such-sock-${process.pid}.sock`);
    const pid = await readSocketHolderPid(phantom, 3000);
    expect(pid).toBeNull();
  });

  it('resolves (bounded) even with a near-zero timeout — recovery can never wedge tui', async () => {
    // The worst case this guards: lsof hangs (stalled mount / huge FD table)
    // while the user is already stranded by a stale runner. A tiny timeout must
    // still settle to null instead of hanging forever. Race it against a wall
    // clock so a regression (unbounded read) fails the test deterministically.
    const phantom = path.join(tmpdir(), `moxxy-timeout-sock-${process.pid}.sock`);
    const settled = readSocketHolderPid(phantom, 1).then(() => 'settled' as const);
    const watchdog = new Promise<'hung'>((r) => {
      const t = setTimeout(() => r('hung'), 2000);
      t.unref?.();
    });
    expect(await Promise.race([settled, watchdog])).toBe('settled');
  });
});
