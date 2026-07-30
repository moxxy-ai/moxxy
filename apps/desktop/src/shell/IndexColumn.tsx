import { useRef, useState, type ReactNode } from 'react';
import { PanelLeftIcon } from './PanelLeftIcon';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/useSidebarCollapsed';
import {
  INDEX_MAX_WIDTH,
  INDEX_MIN_WIDTH,
  setIndexWidth,
  useIndexWidth,
} from '@/lib/useIndexWidth';

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
 * Collapsing (⌘B / Ctrl+B, or the button in the head) ANIMATES its width, matching
 * the app rail. It used to unmount outright, and a thing that is not in the DOM
 * cannot be animated — the column vanished in one frame while the rail beside it
 * eased, which read as a glitch rather than as two panels doing the same thing.
 *
 * Staying mounted means it has to be genuinely out of reach when closed, not just
 * zero pixels wide: `visibility: hidden` (applied AFTER the width finishes, and
 * removed immediately on the way back) takes it out of the accessibility tree and
 * the tab order, and `content-visibility` lets the browser skip rendering the
 * subtree entirely. The instrument bar still grows the expand affordance, so the
 * way back never disappears with it.
 *
 * The workbench deliberately does NOT animate its width — see the note in
 * Workbench.tsx about xterm measuring at mount.
 *
 * It is also drag-resizable from its right edge, with the width persisted, like
 * the workbench. The transition is suppressed WHILE dragging: a width easing
 * toward the pointer lags behind it, which feels like the handle has come loose.
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
  const width = useIndexWidth();
  const ref = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Drag the right edge. The column is pinned to the rail on its left, so
  // width = pointer x − (its left edge). The left edge is captured at
  // pointer-down so the maths survives the column resizing mid-drag.
  const startDrag = (e: React.PointerEvent): void => {
    e.preventDefault();
    const left = ref.current?.getBoundingClientRect().left ?? 0;
    setDragging(true);
    const onMove = (ev: PointerEvent): void => setIndexWidth(ev.clientX - left);
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      setDragging(false);
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <aside
      ref={ref}
      className="index-col"
      data-testid="index-column"
      data-collapsed={collapsed}
      data-dragging={dragging || undefined}
      aria-hidden={collapsed || undefined}
      style={collapsed ? undefined : { width }}
    >
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
      {!collapsed && (
        <div
          role="separator"
          aria-label="Resize the list"
          aria-orientation="vertical"
          aria-valuemin={INDEX_MIN_WIDTH}
          aria-valuemax={INDEX_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          data-testid="index-resize"
          onPointerDown={startDrag}
          // Slider semantics, so it must work without a pointer. The column grows
          // rightward: ArrowRight widens, ArrowLeft narrows, Home/End jump to the
          // clamped extremes. (The workbench grows leftward, so its arrows are
          // the other way round — each matches the direction of its own edge.)
          onKeyDown={(e) => {
            const step = e.shiftKey ? 40 : 16;
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              setIndexWidth(width + step);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setIndexWidth(width - step);
            } else if (e.key === 'Home') {
              e.preventDefault();
              setIndexWidth(INDEX_MIN_WIDTH);
            } else if (e.key === 'End') {
              e.preventDefault();
              setIndexWidth(INDEX_MAX_WIDTH);
            }
          }}
          className="index-col__grip"
        />
      )}
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
