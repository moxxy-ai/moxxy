import { createPortal } from 'react-dom';
import { useTip } from './useTip';

/**
 * Draws the tooltip of whichever control is pointed at. Mounted once for the
 * window, on the document body, so a clipped or scrolling panel cannot cut it.
 * The control's `aria-label` is its name; the bubble is for the eye only.
 */
export function TipLayer(): JSX.Element | null {
  const { tip, bubbleRef } = useTip();
  if (tip === null) return null;
  return createPortal(
    <div
      ref={bubbleRef}
      className="tip-bubble"
      aria-hidden="true"
      data-instant={tip.instant ? 'true' : undefined}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
