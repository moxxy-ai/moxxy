/**
 * The menu-bar mark's blink. AppKit cannot animate a tray icon, so a blink is
 * two image swaps: the closed-eyes frame, then the open one again a moment
 * later. This module owns only the rhythm; the caller owns the images.
 */

export type TrayFrame = 'open' | 'closed';

export interface TrayBlinkOptions {
  /** Paint one frame on the tray. */
  readonly show: (frame: TrayFrame) => void;
  /** Read on every blink, so turning Reduce motion on or off takes effect without a restart. */
  readonly reducedMotion: () => boolean;
  /** The pause before the next blink. */
  readonly nextPauseMs?: () => number;
  /** How long the eyes stay shut. */
  readonly closedMs?: number;
}

const CLOSED_MS = 140;

/** Four to eight seconds: about how often a person blinks, never on a beat. */
export function naturalPauseMs(random: () => number): number {
  return 4000 + Math.floor(random() * 4000);
}

/** Start blinking; the returned function stops it and leaves the eyes open. */
export function startTrayBlink({
  show,
  reducedMotion,
  nextPauseMs = () => naturalPauseMs(Math.random),
  closedMs = CLOSED_MS,
}: TrayBlinkOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const wait = (ms: number, then: () => void): void => {
    timer = setTimeout(then, ms);
  };
  const blink = (): void => {
    if (reducedMotion()) {
      wait(nextPauseMs(), blink);
      return;
    }
    closed = true;
    show('closed');
    wait(closedMs, () => {
      closed = false;
      show('open');
      wait(nextPauseMs(), blink);
    });
  };

  wait(nextPauseMs(), blink);
  return () => {
    clearTimeout(timer);
    if (closed) show('open');
  };
}
