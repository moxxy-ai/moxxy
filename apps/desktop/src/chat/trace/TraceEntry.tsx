import type { ReactNode } from 'react';

/**
 * One entry in the conversation.
 *
 * The kind decides the side: what the person said sits on the right, what the
 * agent said on the left, and the work in between (tools, reasoning,
 * sub-agents) runs down the left as quiet lines. A note is something neither of
 * them said: a trigger, a stop, an error.
 *
 * The entry owns the row and what hangs under a message. The bubble is drawn
 * by the block inside it.
 */

export type TraceKind =
  | 'commanded'
  | 'agent'
  | 'reasoning'
  | 'tool'
  | 'diff'
  | 'terminal'
  | 'subagent'
  | 'trigger'
  | 'system'
  | 'error';

type TraceRole = 'user' | 'agent' | 'activity' | 'note';

const ROLE: Record<TraceKind, TraceRole> = {
  commanded: 'user',
  agent: 'agent',
  reasoning: 'activity',
  tool: 'activity',
  diff: 'activity',
  terminal: 'activity',
  subagent: 'activity',
  trigger: 'note',
  system: 'note',
  error: 'note',
};

export function TraceEntry({
  kind,
  label,
  meta,
  actions,
  live = false,
  children,
  testId,
}: {
  readonly kind: TraceKind;
  /** What this entry is, for the entries whose body does not already say it. */
  readonly label?: string;
  /** A trailing detail: the time of a message, the count of an activity. */
  readonly meta?: ReactNode;
  /** Controls that act on a message; they sit under it with its time. */
  readonly actions?: ReactNode;
  /** Work is in flight: the label takes the moving band the activity rows use. */
  readonly live?: boolean;
  readonly children: ReactNode;
  readonly testId?: string;
}): JSX.Element {
  const role = ROLE[kind];
  const isMessage = role === 'user' || role === 'agent';
  const hasFoot = isMessage && (meta !== undefined || actions !== undefined);
  const hasHead = label !== undefined || (!isMessage && meta !== undefined);
  return (
    <div className="tr" data-kind={kind} data-role={role} data-testid={testId}>
      {hasHead && (
        <div className="tr__hd">
          {label !== undefined && <b className={live ? 'activity-shimmer' : undefined}>{label}</b>}
          {!isMessage && meta !== undefined && <span className="tr__meta">{meta}</span>}
        </div>
      )}
      {children}
      {hasFoot && (
        <div className="tr__foot">
          {actions}
          {meta !== undefined && <span className="tr__meta">{meta}</span>}
        </div>
      )}
    </div>
  );
}
