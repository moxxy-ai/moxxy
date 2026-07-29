import type { ReactNode } from 'react';
import { Icon, type IconName } from '@moxxy/desktop-ui';

/**
 * One entry in the trace.
 *
 * The transcript used to be a bag of shapes: some entries were cards, some were
 * bare rows, some carried a 34px avatar, some were centre-aligned, and each one
 * set its own margins. Nothing established a line for the eye to follow, so a
 * long run read as rubble.
 *
 * Every entry now hangs off ONE continuous hairline in a fixed gutter, with a
 * small typed glyph where it meets the line. That single device does the work the
 * avatars were failing to do: it says what kind of thing this is, it gives the
 * column a spine, and it makes a forty-minute run scannable by shape rather than
 * by reading. Avatars are gone; a repeated 34px portrait of the same two
 * participants is decoration, and it was the widest thing on the left edge.
 */

/** The entry kinds, and the glyph each one hangs on the timeline. */
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

const GLYPH: Record<TraceKind, IconName> = {
  commanded: 'send',
  // Not the mark: the full weave stops resolving below 20px (brand rule), and
  // this glyph is 11px. One strand of it reads at that size; the whole thing
  // collapses into a rosette.
  agent: 'spark',
  reasoning: 'context',
  tool: 'wrench',
  diff: 'diff',
  terminal: 'terminal',
  subagent: 'agent',
  trigger: 'workflow',
  system: 'context',
  error: 'x',
};

export function TraceEntry({
  kind,
  label,
  meta,
  children,
  testId,
}: {
  readonly kind: TraceKind;
  /** Uppercase kicker: who or what this entry is. Omit for entries whose body
   *  already says it (a bare tool row). */
  readonly label?: string;
  /** Right-aligned trailing detail — a timestamp, a duration, a count. */
  readonly meta?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
}): JSX.Element {
  return (
    <div className="tr" data-kind={kind} data-testid={testId}>
      <div className="tr__gutter" aria-hidden>
        <span className="tr__glyph">
          <Icon name={GLYPH[kind]} size={11} />
        </span>
      </div>
      <div className="tr__body">
        {(label !== undefined || meta !== undefined) && (
          <div className="tr__hd">
            {label !== undefined && <b>{label}</b>}
            {meta !== undefined && <span className="tr__meta">{meta}</span>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
