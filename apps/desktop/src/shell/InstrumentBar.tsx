import type { ReactNode } from 'react';
import { PanelLeftIcon } from './PanelLeftIcon';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/useSidebarCollapsed';

/**
 * The instrument bar: the 44px band at the top of the active pane.
 *
 * It replaces a header whose leading element was an anonymous segmented pill
 * (Chat / Collaborate / Apps) and which therefore never said WHERE you were —
 * the workspace path had been pushed out into a right-hand drawer. Navigation
 * now lives in the app rail, so this bar gets its real job back: identify the
 * thing on screen, state what it is doing, and carry its telemetry.
 *
 *   ┌ crumbs ──────────────── state ─┬─ trailing (telemetry, actions) ─┐
 *
 * Its height and bottom seam match `IndexHead` so the two form one horizontal
 * strap running under the app rail.
 */
export function InstrumentBar({
  crumbs,
  state,
  children,
}: {
  /** Path to the thing on screen. The LAST entry is the subject and is
   *  emphasised; the ones before it are context. */
  readonly crumbs: ReadonlyArray<string>;
  /** Run/activity state, rendered right after the crumbs (see {@link StatePill}). */
  readonly state?: ReactNode;
  /** Trailing cluster, right-aligned: telemetry readouts and pane actions. */
  readonly children?: ReactNode;
}): JSX.Element {
  const sidebarCollapsed = useSidebarCollapsed();
  const subject = crumbs.at(-1) ?? '';
  const context = crumbs.slice(0, -1);
  return (
    <header className="instrument">
      {sidebarCollapsed && (
        <button
          type="button"
          aria-label="Expand sidebar"
          data-testid="sidebar-expand"
          title="Expand sidebar (⌘B / Ctrl+B)"
          onClick={() => setSidebarCollapsed(false)}
          className="btn-quiet"
        >
          <PanelLeftIcon size={15} />
        </button>
      )}
      <div className="crumbs">
        {context.map((c) => (
          <span key={c} className="crumbs__ctx">
            <span className="crumbs__seg">{c}</span>
            <span className="crumbs__sep" aria-hidden>
              /
            </span>
          </span>
        ))}
        <span className="crumbs__subject" title={subject}>
          {subject}
        </span>
      </div>
      {state}
      {children !== undefined && <div className="instrument__trailing">{children}</div>}
    </header>
  );
}

/** The states a run can be in, in the order a supervisor cares about them. */
export type RunState = 'running' | 'awaiting' | 'done' | 'failed' | 'idle';

const STATE_LABEL: Record<RunState, string> = {
  running: 'running',
  awaiting: 'awaiting you',
  done: 'done',
  failed: 'failed',
  idle: 'idle',
};

/**
 * The run-state pill. State is encoded twice on purpose — in the hue AND in the
 * word — so it survives both a colour-blind reader and a greyscale screenshot.
 * The LED is the one place a full pill radius is allowed, because there the
 * shape itself is the information.
 */
export function StatePill({ state }: { readonly state: RunState }): JSX.Element {
  return (
    <span className="state-pill" data-state={state}>
      <span className="led" data-state={state} aria-hidden />
      {STATE_LABEL[state]}
    </span>
  );
}
