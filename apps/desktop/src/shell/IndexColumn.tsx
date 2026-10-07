import { useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@moxxy/desktop-ui';
import { MoxxyMark } from '@/components/MoxxyMark';
import { PanelIcon } from './PanelIcon';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/useSidebarCollapsed';
import {
  INDEX_MAX_WIDTH,
  INDEX_MIN_WIDTH,
  setIndexWidth,
  useIndexWidth,
} from '@/lib/useIndexWidth';
import { SidebarAccount } from './account/SidebarAccount';
import { useShellNav } from './navigation/ShellNav';

/**
 * The sidebar: one frame whose list changes with the view.
 *
 * Under Runs it lists workspaces and their runs; under Settings, the sections;
 * and so on. The frame itself owns what every view needs: the way back to the
 * runs, the collapse control, the resize grip, and the account row that leads
 * to every other place in the app.
 *
 * Collapsing (⌘B / Ctrl+B, or the button in the head) is immediate. It is
 * mostly done from the keyboard, and a width that eases would also reflow the
 * conversation on every frame. The column stays mounted while collapsed, so its
 * list keeps its scroll position; `visibility: hidden` takes it out of the
 * accessibility tree and the tab order.
 *
 * It is drag-resizable from its right edge, with the width persisted.
 */
export function IndexColumn({
  title,
  actions,
  toolbar,
  children,
}: {
  /** The view's name, e.g. "runs". */
  readonly title: string;
  /** Trailing controls in the head (new, …). */
  readonly actions?: ReactNode;
  /** A fixed strip between the head and the list, e.g. a search field. */
  readonly toolbar?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element | null {
  const nav = useShellNav();
  const awayFromRuns = nav !== null && nav.view !== 'chat';
  const collapsed = useSidebarCollapsed();
  const width = useIndexWidth();
  const ref = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Drag the right edge. The column is pinned to the window's left, so
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
        {awayFromRuns ? (
          <button
            type="button"
            className="btn-quiet tip"
            data-testid="sidebar-back"
            aria-label="Back to runs"
            data-tip="Back to runs"
            data-tip-side="bottom"
            onClick={() => nav.go('chat')}
          >
            <Icon name="chevron-right" size={16} className="icon-flip" />
          </button>
        ) : (
          <span className="index-col__mark" aria-hidden>
            <MoxxyMark size={20} />
          </span>
        )}
        <span className="index-col__title">{title}</span>
        {actions}
        <button
          type="button"
          aria-label="Collapse sidebar"
          data-testid="sidebar-collapse"
          onClick={() => setSidebarCollapsed(true)}
          className="btn-quiet tip"
          data-tip="Hide sidebar"
          data-tip-side="bottom"
        >
          <PanelIcon size={15} />
        </button>
      </div>
      {toolbar !== undefined && <div className="index-col__toolbar">{toolbar}</div>}
      <div className="index-col__body">{children}</div>
      {nav !== null && <SidebarAccount />}
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

export type IndexLed = 'off' | 'running' | 'awaiting' | 'done' | 'failed';

/** A row in a list that is not a run: a settings section, an automation, a
 *  channel. Its light and its note are for rows that have a state to report. */
export function IndexRow({
  label,
  active,
  onPick,
  icon,
  led,
  note,
  noteTone,
  nested = false,
  testId,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPick: () => void;
  /** For a row that is a place to go; a caption never has one. */
  readonly icon?: IconName;
  readonly led?: IndexLed;
  readonly note?: string;
  readonly noteTone?: 'bad';
  /** The row sits under a group that folds, so it is indented past the chevron. */
  readonly nested?: boolean;
  readonly testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className="index-row"
      data-testid={testId}
      data-active={active}
      data-nested={nested || undefined}
      aria-current={active ? 'true' : undefined}
      onClick={onPick}
    >
      {led !== undefined && (
        <span className="led" data-state={led === 'off' ? undefined : led} aria-hidden />
      )}
      {icon !== undefined && <Icon name={icon} size={15} className="index-row__icon" />}
      <span className="index-row__label">{label}</span>
      {note !== undefined && (
        <span className="index-row__note" data-tone={noteTone}>
          {note}
        </span>
      )}
    </button>
  );
}

/** What a group says when it holds nothing. */
export function IndexEmpty({ children }: { readonly children: ReactNode }): JSX.Element {
  return <p className="index-empty">{children}</p>;
}
