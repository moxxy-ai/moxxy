import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';

export interface FocusMiniTextSize {
  readonly width: number;
  readonly height: number;
}

export const FOCUS_MINI_TEXT_DEFAULT_SIZE: FocusMiniTextSize = {
  width: 380,
  height: 440,
};

export const FOCUS_MINI_TEXT_MIN_SIZE: FocusMiniTextSize = {
  width: 320,
  height: 260,
};

export const FOCUS_MINI_TEXT_MAX_SIZE = 1600;
export const FOCUS_MINI_TEXT_RESIZE_SAVE_DELAY_MS = 250;

function clampDimension(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(FOCUS_MINI_TEXT_MAX_SIZE, Math.max(min, Math.round(value)));
}

export function clampFocusMiniTextSize(size: FocusMiniTextSize): FocusMiniTextSize {
  return {
    width: clampDimension(size.width, FOCUS_MINI_TEXT_MIN_SIZE.width),
    height: clampDimension(size.height, FOCUS_MINI_TEXT_MIN_SIZE.height),
  };
}

function sameSize(a: FocusMiniTextSize, b: FocusMiniTextSize): boolean {
  return a.width === b.width && a.height === b.height;
}

export function useFocusMiniTextSize(active: boolean): FocusMiniTextSize {
  const [size, setSize] = useState<FocusMiniTextSize>(FOCUS_MINI_TEXT_DEFAULT_SIZE);
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void api()
      .invoke('prefs.read')
      .then((prefs) => {
        if (cancelled) return;
        const next = prefs.focusMiniTextSize
          ? clampFocusMiniTextSize(prefs.focusMiniTextSize)
          : FOCUS_MINI_TEXT_DEFAULT_SIZE;
        setSize((current) => (sameSize(current, next) ? current : next));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) hydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let timer: number | undefined;
    const persistWindowSize = (): void => {
      if (!hydrated.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = clampFocusMiniTextSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
        setSize((current) => (sameSize(current, next) ? current : next));
        void api()
          .invoke('prefs.update', { focusMiniTextSize: next })
          .catch(() => undefined);
      }, FOCUS_MINI_TEXT_RESIZE_SAVE_DELAY_MS);
    };
    window.addEventListener('resize', persistWindowSize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', persistWindowSize);
    };
  }, [active]);

  return size;
}
