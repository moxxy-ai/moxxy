import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  // Callback ref, not useRef: a portal target has to trigger a render when it
  // attaches, or the first paint has nowhere to put the actions.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => setSlot(el), []);
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
      <div className="instrument__trailing">
        {/* Panes that own their action state render into here through
         *  {@link BarActions} rather than lifting it up to the shell. */}
        <div ref={attach} className="instrument__slot" />
        {children}
      </div>
      <BarSlotProvider slot={slot} />
    </header>
  );
}

/* The bar's action slot, as a module store. A pane deep inside the tree (a
 * settings tab that owns its own "adding" flag) has to put a button in the bar
 * without every one of those flags moving up to the shell. */

let barSlot: HTMLElement | null = null;
const slotListeners = new Set<() => void>();

function BarSlotProvider({ slot }: { readonly slot: HTMLElement | null }): null {
  if (barSlot !== slot) {
    barSlot = slot;
    // Deferred: notifying subscribers during this render would set state on
    // them mid-commit.
    queueMicrotask(() => {
      for (const fn of slotListeners) fn();
    });
  }
  return null;
}

/**
 * Render `children` into the current pane's instrument bar.
 *
 * Falls back to rendering IN PLACE when no bar is mounted. A pane's only action
 * silently vanishing because its host forgot a bar is the worse failure of the
 * two, and it is the one a test harness hits first.
 */
export function BarActions({ children }: { readonly children: ReactNode }): JSX.Element {
  const slot = useSyncExternalStore(subscribeSlot, () => barSlot, () => barSlot);
  return slot ? createPortal(children, slot) : <>{children}</>;
}

function subscribeSlot(fn: () => void): () => void {
  slotListeners.add(fn);
  return () => {
    slotListeners.delete(fn);
  };
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
 * On a narrow bar the word drops and the LED stays (see the container queries).
 * The LED is the one place a full pill radius is allowed, because there the
 * shape itself is the information.
 */
export function StatePill({ state }: { readonly state: RunState }): JSX.Element {
  return (
    // `role="img"` + aria-label rather than an extra screen-reader-only copy of
    // the word: the label has to survive the container query that hides the
    // visible text on a narrow bar, and a duplicated string would be announced
    // twice at every other width.
    <span
      className="state-pill"
      data-state={state}
      role="img"
      aria-label={`Run ${STATE_LABEL[state]}`}
    >
      <span className="led" data-state={state} aria-hidden />
      <span className="state-pill__label">{STATE_LABEL[state]}</span>
    </span>
  );
}
