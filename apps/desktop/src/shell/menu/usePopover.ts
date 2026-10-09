import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { useMenuKeyboard } from '../useMenuKeyboard';

export interface PopoverPlacement {
  /** Which side of the anchor the popover opens on. */
  readonly side: 'top' | 'bottom';
  /** Which edge of the anchor it lines up with. */
  readonly align: 'start' | 'end';
  readonly width: number;
}

export interface PopoverOptions extends PopoverPlacement {
  readonly onOpenChange?: (open: boolean) => void;
}

export interface Popover<A extends HTMLElement, M extends HTMLElement> {
  readonly open: boolean;
  /** Opened from the keyboard, so it appears without an entrance animation. */
  readonly instant: boolean;
  readonly anchorRef: RefObject<A>;
  readonly menuRef: RefObject<M>;
  /** Fixed position and transform origin; null until the anchor is measured. */
  readonly style: CSSProperties | null;
  /** For the anchor's `onClick`. `detail` is 0 for a keyboard activation. */
  readonly toggle: (event: { readonly detail: number }) => void;
  readonly close: () => void;
}

const GAP = 6;
const MARGIN = 8;

function place(anchor: HTMLElement, { side, align, width }: PopoverPlacement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || width;
  const wanted = align === 'start' ? rect.left : rect.right - width;
  const left = Math.min(Math.max(MARGIN, wanted), Math.max(MARGIN, viewportWidth - width - MARGIN));
  const vertical =
    side === 'top'
      ? { bottom: window.innerHeight - rect.top + GAP }
      : { top: rect.bottom + GAP };
  return {
    position: 'fixed',
    left,
    width,
    ...vertical,
    // The corner nearest the anchor, so the popover grows out of its trigger.
    transformOrigin: `${side === 'top' ? 'bottom' : 'top'} ${align === 'start' ? 'left' : 'right'}`,
  };
}

/**
 * An anchored popover menu: where it sits, when it closes, and whether it may
 * animate. Focus and arrow keys inside it come from {@link useMenuKeyboard}.
 */
export function usePopover<A extends HTMLElement, M extends HTMLElement>(
  options: PopoverOptions,
): Popover<A, M> {
  const { side, align, width, onOpenChange } = options;
  const anchorRef = useRef<A>(null);
  const [state, setState] = useState<{ style: CSSProperties; instant: boolean } | null>(null);
  const open = state !== null;
  const menuRef = useMenuKeyboard<M>(open);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;

  const close = useCallback((): void => {
    setState(null);
    notify.current?.(false);
  }, []);

  const toggle = useCallback(
    (event: { readonly detail: number }): void => {
      const anchor = anchorRef.current;
      if (open || !anchor) {
        close();
        return;
      }
      setState({ style: place(anchor, { side, align, width }), instant: event.detail === 0 });
      notify.current?.(true);
    },
    [open, close, side, align, width],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const reposition = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setState((s) => (s ? { ...s, style: place(anchor, { side, align, width }) } : s));
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, close, menuRef, side, align, width]);

  return {
    open,
    instant: state?.instant ?? false,
    anchorRef,
    menuRef,
    style: state?.style ?? null,
    toggle,
    close,
  };
}
