import type { ReactNode } from 'react';
import { Icon, type IconName } from '@moxxy/desktop-ui';

/**
 * Shared, deliberately quiet activity header used by tools and skills.
 *
 * The chevron LEADS. A trailing chevron makes a row look openable only after the
 * eye has crossed the whole label, and this row is often one of thirty — the
 * disclosure state should be readable down the left edge in one pass.
 *
 * `icon` is optional and deliberately absent on group headers. A skill scope used
 * the `spark` glyph, which reads as a spinner sitting in front of the label, and
 * the trace gutter already carries the type marker for the whole entry — a second
 * glyph inside it was both redundant and misleading.
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
      <span
        className="activity-row__chevron"
        aria-hidden
        style={{ transform: open ? 'rotate(90deg)' : 'none' }}
      >
        <Icon name="chevron-right" size={12} />
      </span>
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
