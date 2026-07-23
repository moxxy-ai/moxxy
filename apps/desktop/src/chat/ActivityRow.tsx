import type { ReactNode } from 'react';
import { Icon, type IconName } from '@moxxy/desktop-ui';

/** Shared, deliberately quiet activity header used by tools and skills. */
export function ActivityRow({
  icon,
  label,
  meta,
  active,
  open,
  onToggle,
  testId,
}: {
  readonly icon: IconName;
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
      <span className="activity-row__icon" aria-hidden>
        <Icon name={icon} size={18} />
      </span>
      <span className={`activity-row__label${active ? ' activity-shimmer' : ''}`}>{label}</span>
      {meta ? <span className="activity-row__meta">{meta}</span> : null}
      <span
        className="activity-row__chevron"
        aria-hidden
        style={{ transform: open ? 'rotate(90deg)' : 'none' }}
      >
        <Icon name="chevron-right" size={14} />
      </span>
    </button>
  );
}
