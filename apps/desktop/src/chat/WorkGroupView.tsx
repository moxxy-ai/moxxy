import type { ReactNode } from 'react';
import type { WorkNode } from '@moxxy/client-core';
import { ActivityRow } from './ActivityRow';
import { useWorkGroup } from './useWorkGroup';

/**
 * What the agent did in a finished turn before its answer, folded into one row
 * ("Worked for 4m 12s · 12 steps"). Opened, it shows every step as the
 * conversation drew it; `children` are those steps.
 */
export function WorkGroupView({
  group,
  children,
}: {
  readonly group: WorkNode;
  readonly children: ReactNode;
}): JSX.Element {
  const { label, steps, open, toggle } = useWorkGroup(group);
  return (
    <div className="activity-block work-group" data-testid="block-work-group" data-open={open ? 'true' : 'false'}>
      <ActivityRow
        label={label}
        meta={<span>{steps}</span>}
        open={open}
        onToggle={toggle}
      />
      {open && <div className="work-group__steps">{children}</div>}
    </div>
  );
}
