import type { ReactNode } from 'react';
import type { WorkNode } from '@moxxy/client-core';
import { ActivityCount } from './SkillGroupView';
import { StreamingReasoning } from './blocks/StreamingReasoning';
import { ActivityRow } from './ActivityRow';
import { useWorkGroup } from './useWorkGroup';

/**
 * What the agent did during a turn and before its final answer, folded into one row
 * ("Worked for 4m 12s · 12 steps"). Opened, it shows every step as the
 * conversation drew it; `children` are those steps.
 */
export function WorkGroupView({
  group,
  children,
  streamingReasoning,
}: {
  readonly group: WorkNode;
  readonly children: () => ReactNode;
  readonly streamingReasoning?: string;
}): JSX.Element {
  const { label, steps, failed, open, toggle } = useWorkGroup(group, Boolean(streamingReasoning));
  return (
    <div className="activity-block work-group" data-testid="block-work-group" data-open={open ? 'true' : 'false'}>
      <ActivityRow
        label={group.active ? <span role="status">{label}</span> : label}
        active={group.active}
        meta={<><ActivityCount total={0} failed={failed} />{group.steps > 0 && <span>{steps}</span>}</>}
        open={open}
        onToggle={toggle}
      />
      {open && <div className="work-group__steps">{children()}{streamingReasoning && <StreamingReasoning text={streamingReasoning} />}</div>}
    </div>
  );
}
