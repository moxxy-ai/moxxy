import { describe, expect, it } from 'vitest';
import { naturalPauseMs, startTrayBlink, type TrayFrame } from './tray-blink';

// Real timers with millisecond pauses: the blink is a timing loop, and a few
// real milliseconds exercise it end to end without faking the clock.
const fast = { nextPauseMs: () => 4, closedMs: 4 } as const;

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('startTrayBlink', () => {
  it('closes the eyes after a pause, opens them again, and keeps blinking', async () => {
    const frames: TrayFrame[] = [];
    const stop = startTrayBlink({ ...fast, show: (frame) => frames.push(frame), reducedMotion: () => false });

    await expect.poll(() => frames.length, { timeout: 1000 }).toBeGreaterThanOrEqual(4);
    stop();

    expect(frames.slice(0, 4)).toEqual(['closed', 'open', 'closed', 'open']);
  });

  it('stops for good, with the eyes left open', async () => {
    const frames: TrayFrame[] = [];
    const stop = startTrayBlink({ ...fast, show: (frame) => frames.push(frame), reducedMotion: () => false });
    await expect.poll(() => frames.length, { timeout: 1000 }).toBeGreaterThanOrEqual(1);

    stop();
    const seen = frames.length;
    await settle(40);

    expect(frames.length - seen).toBeLessThanOrEqual(1);
    expect(frames.at(-1)).toBe('open');
  });

  it('does not blink while the system asks for reduced motion, and resumes when it stops', async () => {
    const frames: TrayFrame[] = [];
    let reduced = true;
    const stop = startTrayBlink({ ...fast, show: (frame) => frames.push(frame), reducedMotion: () => reduced });

    await settle(40);
    expect(frames).toEqual([]);

    reduced = false;
    await expect.poll(() => frames.length, { timeout: 1000 }).toBeGreaterThanOrEqual(2);
    stop();
    expect(frames.slice(0, 2)).toEqual(['closed', 'open']);
  });

});

describe('naturalPauseMs', () => {
  it('spreads blinks four to eight seconds apart', () => {
    // A metronome blink reads as a warning light; people blink every few seconds.
    expect(naturalPauseMs(() => 0)).toBe(4000);
    expect(naturalPauseMs(() => 0.5)).toBe(6000);
    expect(naturalPauseMs(() => 0.999)).toBeLessThan(8000);
  });
});
