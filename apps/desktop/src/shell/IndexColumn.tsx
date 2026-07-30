import type { ReactNode } from 'react';
import { PanelLeftIcon } from './PanelLeftIcon';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/useSidebarCollapsed';

/**
 * The index column: the contextual list beside the app rail.
 *
 * One column whose CONTENTS change per destination (workspaces + sessions under
 * Runs, workflow kinds under Automations, and so on) rather than a different
 * organ per view. That is the whole point of the split-nav fix: the rail says
 * where you are, the index says what is there.
 *
 * `IndexHead` is deliberately the same height as the instrument bar
 * (`--frame-bar`) and carries the same bottom seam, so the two read as ONE
 * horizontal strap crossing under the rail. It also paints above the rail's
 * stacking order so the active item's commanded strap passes under that seam.
 *
 * Collapsing is unchanged in behaviour (⌘B / Ctrl+B, or the button in the head):
 * the column contributes no width at all when collapsed, and the instrument bar
 * grows the expand affordance so it never disappears with the column.
 */
export function IndexColumn({
  title,
  actions,
  children,
  footer,
}: {
  /** Uppercase label for the column, e.g. "runs" — or a control that replaces it
   *  (the search field takes the title's place while it is open, the way the
   *  instrument bar's search does). */
  readonly title: ReactNode;
  /** Trailing controls in the head (search, new, …). */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  /** Pinned strip at the bottom — budget, totals, status. */
  readonly footer?: ReactNode;
}): JSX.Element | null {
  const collapsed = useSidebarCollapsed();
  if (collapsed) return null;
  return (
    <aside className="index-col">
      <div className="index-col__head">
        {typeof title === 'string' ? (
          <span className="index-col__title">{title}</span>
        ) : (
          title
        )}
        {actions}
        <button
          type="button"
          aria-label="Collapse sidebar"
          data-testid="sidebar-collapse"
          title="Collapse sidebar (⌘B / Ctrl+B)"
          onClick={() => setSidebarCollapsed(true)}
          className="btn-box tip"
          data-tip="Collapse"
          data-tip-side="bottom"
        >
          <PanelLeftIcon size={14} />
        </button>
      </div>
      <div className="index-col__body">{children}</div>
      {footer !== undefined && <div className="index-col__foot">{footer}</div>}
    </aside>
  );
}

/** A group label inside the index body ("blocky", "by kind", "history"). Takes
 *  an optional trailing count, right-aligned with tabular figures so a column
 *  of groups lines up. */
export function IndexGroup({
  label,
  count,
  children,
}: {
  readonly label: string;
  readonly count?: number;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <div className="index-group">
      <span className="index-group__label">{label}</span>
      {children}
      {count !== undefined && <span className="index-group__count">{count}</span>}
    </div>
  );
}
