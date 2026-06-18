/**
 * Unit tests for armBootProbe's state machine, with a fake webContents + injected
 * persistence/relaunch deps. Covers: no-op on the floor, confirm-via-DOM, the
 * fast-path heartbeat, and timeout → markBad + relaunch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { armBootProbe, type BootProbeDeps } from './boot-probe.js';

/** A fake BrowserWindow exposing only what the probe touches. */
function fakeWindow(opts: { reactMounted: boolean; destroyed?: boolean }) {
  let finishLoad: (() => void) | undefined;
  const win = {
    isDestroyed: () => opts.destroyed ?? false,
    webContents: {
      once: (ev: string, cb: () => void) => {
        if (ev === 'did-finish-load') finishLoad = cb;
      },
      executeJavaScript: vi.fn(async () => opts.reactMounted),
    },
  };
  return { win: win as unknown as BrowserWindow, fireFinishLoad: () => finishLoad?.() };
}

function deps(over: Partial<BootProbeDeps> = {}): BootProbeDeps {
  return {
    version: 'v1.2.3',
    userData: '/ud',
    shell: { electron: '30', nodeAbi: '125' },
    readConfirmed: vi.fn(() => null),
    markConfirmed: vi.fn(),
    markBad: vi.fn(),
    appendBootLog: vi.fn(),
    relaunch: vi.fn(),
    quit: vi.fn(),
    ...over,
  };
}

describe('armBootProbe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is a no-op on the floor (no override version)', () => {
    const { win, fireFinishLoad } = fakeWindow({ reactMounted: true });
    const d = deps({ version: undefined });
    armBootProbe(win, d);
    fireFinishLoad();
    expect(d.markConfirmed).not.toHaveBeenCalled();
    expect(d.markBad).not.toHaveBeenCalled();
  });

  it('confirms from the main-side DOM check when React has mounted', async () => {
    const { win, fireFinishLoad } = fakeWindow({ reactMounted: true });
    const d = deps();
    armBootProbe(win, d);
    fireFinishLoad();
    await vi.runOnlyPendingTimersAsync();
    expect(d.markConfirmed).toHaveBeenCalledWith('/ud', 'v1.2.3');
    expect(d.appendBootLog).toHaveBeenCalledWith(
      '/ud',
      expect.objectContaining({ phase: 'confirm', picked: 'v1.2.3', reason: 'main-side-dom' }),
    );
    expect(d.markBad).not.toHaveBeenCalled();
  });

  it('fast-paths via the heartbeat without touching the DOM', async () => {
    const { win, fireFinishLoad } = fakeWindow({ reactMounted: false });
    const d = deps({ readConfirmed: vi.fn(() => 'v1.2.3') });
    armBootProbe(win, d);
    fireFinishLoad();
    await vi.runOnlyPendingTimersAsync();
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(d.markConfirmed).not.toHaveBeenCalled();
    expect(d.markBad).not.toHaveBeenCalled();
  });

  it('poisons + relaunches when the bundle never renders within the timeout', async () => {
    const { win, fireFinishLoad } = fakeWindow({ reactMounted: false });
    const d = deps();
    armBootProbe(win, d);
    fireFinishLoad();
    // Advance past the 15s timeout, draining each 1.5s poll.
    await vi.advanceTimersByTimeAsync(16_000);
    expect(d.markBad).toHaveBeenCalledWith('/ud', 'v1.2.3');
    expect(d.relaunch).toHaveBeenCalledTimes(1);
    expect(d.quit).toHaveBeenCalledTimes(1);
    expect(d.appendBootLog).toHaveBeenCalledWith(
      '/ud',
      expect.objectContaining({ phase: 'probe', reason: 'no-render-within-timeout' }),
    );
  });
});
