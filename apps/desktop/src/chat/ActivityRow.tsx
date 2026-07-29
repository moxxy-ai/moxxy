import type { ReactNode } from 'react';
import { Icon, type IconName } from '@moxxy/desktop-ui';

/**
 * Shared, deliberately quiet activity header used by tools and skills.
 *
 * There is NO chevron, and no reserved space for one. These rows arrive thirty at
 * a time, and a disclosure caret on each was thirty pieces of punctuation the eye
 * had to skip past to reach the content. The whole row is the control, and the
 * nested list appearing underneath is the feedback; `aria-expanded` carries the
 * state for anyone who needs it stated.
 *
 * `icon` is optional and deliberately absent on group headers. A skill scope used
 * the `spark` glyph, which reads as a spinner sitting permanently in front of the
 * label, and the trace gutter already carries the type marker for the whole entry.
 */
export function ActivityRow({
  icon,
  label,
  meta,
  active,
  open,
  onToggle,
  testId,
}: {
  readonly icon?: IconName;
  readonly label: ReactNode;
  readonly meta?: ReactNode;
  readonly active?: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className="activity-row"
      onClick={onToggle}
      aria-expanded={open}
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
    >
      {icon !== undefined && (
        <span className="activity-row__icon" aria-hidden>
          <Icon name={icon} size={14} />
        </span>
      )}
      <span className={`activity-row__label${active ? ' activity-shimmer' : ''}`}>{label}</span>
      {meta ? <span className="activity-row__meta">{meta}</span> : null}
    </button>
  );
}
