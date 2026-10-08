import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { placeTip, type TipSide } from './placeTip';

export interface Tip {
  readonly text: string;
  /** Shown without the pause or the fade: the pointer came from another tip, or the keyboard did. */
  readonly instant: boolean;
}

/** How long the pointer rests on a control before its tip shows. */
const SHOW_DELAY_MS = 140;
/** After a tip closes, the next one within this long shows at once. */
const WARM_MS = 400;

const SIDES: ReadonlySet<string> = new Set(['right', 'left', 'bottom', 'top']);

function tipHost(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const host = target.closest('[data-tip]');
  if (!(host instanceof HTMLElement)) return null;
  return host.dataset.tip ? host : null;
}

function sideOf(host: HTMLElement): TipSide {
  const side = host.dataset.tipSide ?? 'right';
  return SIDES.has(side) ? (side as TipSide) : 'right';
}

/**
 * The window's one tooltip. Any control with `data-tip` gets it: after a short
 * rest of the pointer, or at once when the keyboard lands on it. It closes
 * when the pointer leaves, the control is pressed, a key goes down or the
 * control scrolls away.
 */
export function useTip(): { readonly tip: Tip | null; readonly bubbleRef: RefObject<HTMLDivElement> } {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedAt = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    const cancel = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = (): void => {
      cancel();
      if (host.current === null) return;
      host.current = null;
      closedAt.current = Date.now();
      setTip(null);
    };
    const show = (next: HTMLElement, instant: boolean): void => {
      cancel();
      host.current = next;
      setTip({ text: next.dataset.tip ?? '', instant });
    };

    const onOver = (e: MouseEvent): void => {
      const next = tipHost(e.target);
      if (next === null || next === host.current) return;
      const warm = host.current !== null || Date.now() - closedAt.current < WARM_MS;
      if (warm) {
        show(next, true);
        return;
      }
      cancel();
      timer.current = setTimeout(() => show(next, false), SHOW_DELAY_MS);
    };
    const onOut = (e: MouseEvent): void => {
      const from = tipHost(e.target);
      if (from === null) return;
      if (e.relatedTarget instanceof Node && from.contains(e.relatedTarget)) return;
      if (from === host.current) hide();
      else cancel();
    };
    // A control can be unmounted under the pointer, and then it never reports
    // the pointer leaving.
    const onMove = (): void => {
      if (host.current !== null && !host.current.isConnected) hide();
    };
    // Only a scroll that moves the control: a transcript streaming elsewhere
    // must not close the tip of a control that has not moved.
    const onScroll = (e: Event): void => {
      if (host.current !== null && e.target instanceof Node && e.target.contains(host.current)) hide();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const focused = tipHost(document.activeElement);
      if (focused !== null) show(focused, true);
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', hide);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', hide);
    return () => {
      cancel();
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', hide);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Measured after it is laid out and before it is painted, so it never shows
  // in the wrong place first.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const anchor = host.current;
    if (tip === null || bubble === null || anchor === null) return;
    const placed = placeTip(
      anchor.getBoundingClientRect(),
      bubble.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      sideOf(anchor),
    );
    bubble.style.left = `${placed.left}px`;
    bubble.style.top = `${placed.top}px`;
    bubble.dataset.side = placed.side;
  }, [tip]);

  return { tip, bubbleRef };
}
