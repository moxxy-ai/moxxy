import type { ReactNode } from 'react';
import { Icon } from '@moxxy/desktop-ui';

/**
 * The folded head of a piece of work that has a body to open: a sub-agent, a
 * fan-out of them, a team. A state light, the name, an optional detail and
 * count, and the chevron that says there is more.
 */
export function DisclosureRow({
  state,
  label,
  detail,
  meta,
  live = false,
  open,
  onToggle,
}: {
  readonly state: 'running' | 'awaiting' | 'done' | 'failed';
  readonly label: string;
  /** A short qualifier beside the name. */
  readonly detail?: ReactNode;
  /** A count or reading, pushed to the far edge. */
  readonly meta?: ReactNode;
  /** Work is in flight: the name takes the moving band. */
  readonly live?: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <button type="button" className="disclosure" onClick={onToggle} aria-expanded={open}>
      <span className="led" data-state={state} aria-hidden />
      <span className={live ? 'disclosure__label activity-shimmer' : 'disclosure__label'}>
        {label}
      </span>
      {detail !== undefined && <span className="disclosure__detail">{detail}</span>}
      {meta !== undefined && <span className="disclosure__meta">{meta}</span>}
      <span className="disclosure__chevron" data-open={open} aria-hidden>
        <Icon name="chevron-right" size={12} />
      </span>
    </button>
  );
}
