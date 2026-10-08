import type { AriaRole } from 'react';
import { useClipped } from '@/lib/useClipped';
import type { TipSide } from './placeTip';

/**
 * Text its own styles may cut short. Whenever they do, the pointer gets all of
 * it in the window's tooltip; text that is all there to read gets none.
 */
export function ClippedText({
  text,
  className,
  role,
  side = 'top',
}: {
  readonly text: string;
  readonly className: string;
  readonly role?: AriaRole;
  readonly side?: TipSide;
}): JSX.Element {
  const { ref, clipped } = useClipped<HTMLSpanElement>(text);
  return (
    <span ref={ref} className={className} role={role} data-tip={clipped ? text : undefined} data-tip-side={side}>
      {text}
    </span>
  );
}
