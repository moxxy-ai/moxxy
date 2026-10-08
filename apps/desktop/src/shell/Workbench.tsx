/**
 * The workbench: the right-hand pane, with one tab per kind of work (terminal,
 * files, diff, browser).
 *
 * Closed, it draws nothing and takes no room; the run's header holds the way
 * in. The element itself stays in the tree, because of the browser (below).
 *
 * Two constraints are load-bearing:
 *
 *   - Width is NEVER transitioned. TerminalPane's xterm `fit()` measures at
 *     mount, and an animated width let it measure a sliver and lock the PTY to
 *     a couple of columns. Open and close snap.
 *   - The active pane is mounted only while the workbench is open, so a pane
 *     never mounts into a zero-width box.
 *
 * The browser is the exception: once opened it stays mounted, parked
 * off-screen while the workbench is closed or showing another pane. Unmounting
 * it destroys its pages (a `<webview>` dies with its element), so a tab would
 * vanish on a close.
 */

import { useRef, useState } from 'react';
import { deskForWorkspace, useDesks } from '@moxxy/client-core';
import { Icon, type IconName } from '@moxxy/desktop-ui';
import { chordLabel } from '@/hotkeys/chordLabel';
import {
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  benchWidthLimit,
  setRailWidth,
  useRailWidth,
} from '../lib/useRailWidth';
import { TerminalPane } from './surfaces/TerminalPane';
import { FilesPane } from './surfaces/FilesPane';
import { FilesExplorerPane } from './surfaces/FilesExplorerPane';
import { BrowserPane } from './surfaces/BrowserPane';

/** The workbench tabs. Names say what the pane IS: `diff` is the git-changed
 *  set with its diff (the old "Files changed"), `files` browses the workspace
 *  (the old "Files"). The old ids are kept so persisted state and the
 *  agent-reveal seam below do not need a migration. */
export type WorkbenchTab = 'terminal' | 'files' | 'explorer' | 'browser';

interface TabDef {
  readonly id: WorkbenchTab;
  readonly label: string;
  readonly icon: IconName;
}

const TABS: ReadonlyArray<TabDef> = [
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'explorer', label: 'Files', icon: 'file' },
  { id: 'files', label: 'Diff', icon: 'diff' },
  { id: 'browser', label: 'Browser', icon: 'globe' },
];

/**
 * Agent tool name → the tab that showcases that tool's work. Colocated with the
 * tabs so adding a surface-backed pane is a single edit here; the auto-reveal in
 * {@link ./surfaces/useAgentSurfaceReveal} reads this seam rather than carrying
 * its own copy.
 */
const TOOL_TAB: Readonly<Record<string, WorkbenchTab>> = {
  terminal: 'terminal',
};

/**
 * The workbench tab a given agent tool should reveal, or undefined if none.
 * Every `browser_*` tool reveals the browser: a tab the agent asks for is made
 * by the pane, so with the pane closed the request waits and times out.
 */
export function workbenchTabForTool(toolName: string): WorkbenchTab | undefined {
  if (toolName.startsWith('browser_')) return 'browser';
  return TOOL_TAB[toolName];
}

export function Workbench({
  tab,
  onPick,
  onClose,
  workspaceId,
  changedCount,
  full = false,
  onToggleFull,
}: {
  /** Active tab, or null when the workbench is closed. */
  readonly tab: WorkbenchTab | null;
  readonly onPick: (tab: WorkbenchTab) => void;
  readonly onClose: () => void;
  readonly workspaceId: string | null;
  /** Count on the Diff tab. Undefined while unknown (not a git repo, not
   *  loaded yet) so an unknown count never renders as a confident zero. */
  readonly changedCount?: number;
  /** Full view: the pane fills the window and the chat floats over it as a
   *  composer. Ignored while collapsed. */
  readonly full?: boolean;
  /** Offered as a button on an open workbench when given. */
  readonly onToggleFull?: () => void;
}): JSX.Element {
  const desks = useDesks();
  const active = deskForWorkspace(desks.desks, workspaceId);
  const width = useRailWidth();
  const ref = useRef<HTMLElement | null>(null);
  const open = tab !== null;
  const isFull = open && full;
  const [browserStarted, setBrowserStarted] = useState(false);
  // The widest the last drag could go; the separator reports it as its maximum.
  const [limit, setLimit] = useState<number | null>(null);
  if (tab === 'browser' && !browserStarted) setBrowserStarted(true);

  // The widest the workbench can be: its own width plus what the chat beside it
  // (the element before it) can spare. Measured, because that depends on the
  // window and on whatever else is open, not on a constant.
  const measureLimit = (): number => {
    const own = ref.current?.getBoundingClientRect().width ?? width;
    const chat = ref.current?.previousElementSibling?.getBoundingClientRect().width ?? 0;
    const next = benchWidthLimit(own, chat);
    setLimit(next);
    return next;
  };

  // Drag the left edge to resize. The workbench is pinned to the window's right
  // edge, so width = (its right edge) − pointer x. Capture the right edge and
  // the limit at pointer-down so the maths survives the panel itself resizing
  // mid-drag.
  const startDrag = (e: React.PointerEvent): void => {
    e.preventDefault();
    const right = ref.current?.getBoundingClientRect().right ?? window.innerWidth;
    const max = measureLimit();
    const onMove = (ev: PointerEvent): void => setRailWidth(Math.min(max, right - ev.clientX));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // One <aside> in both states, the body always last: the kept browser must
  // stay at the same place in the tree, or React remounts it.
  return (
    <aside
      ref={ref}
      className={!open ? 'bench bench--closed' : isFull ? 'bench bench--full' : 'bench'}
      aria-label="Workbench"
      aria-hidden={open ? undefined : true}
      style={open && !isFull ? { width } : undefined}
    >
      {open && (
        <>
          {!isFull && <div
            role="separator"
            aria-label="Resize workbench"
            aria-orientation="vertical"
            aria-valuemin={RAIL_MIN_WIDTH}
            aria-valuemax={limit ?? RAIL_MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={startDrag}
            onFocus={measureLimit}
            // The separator advertises slider semantics, so it must be operable
            // without a pointer. The panel grows leftward: ArrowLeft widens,
            // ArrowRight narrows, Home/End jump to the clamped extremes.
            onKeyDown={(e) => {
              const step = e.shiftKey ? 40 : 16;
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setRailWidth(Math.min(measureLimit(), width + step));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setRailWidth(width - step);
              } else if (e.key === 'Home') {
                e.preventDefault();
                setRailWidth(measureLimit());
              } else if (e.key === 'End') {
                e.preventDefault();
                setRailWidth(RAIL_MIN_WIDTH);
              }
            }}
            title="Drag to resize"
            className="bench__grip"
          />}

          <div className="bench__tabs">
            {/* The tab row scrolls; the collapse cell after it never shrinks. Four
                labelled tabs are wider than a narrow workbench, and when they lived
                in the same flex row as the collapse button they pushed it past the
                right edge — so an opened workbench could not be closed at all. */}
            <div className="bench__tablist" role="tablist" aria-label="Workbench panes">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  className="bench__tab"
                  data-testid={`bench-tab-${t.id}`}
                  data-active={t.id === tab}
                  aria-selected={t.id === tab}
                  // Clicking the ACTIVE tab collapses the workbench: a second, more
                  // discoverable way out than hunting for the chevron, and the same
                  // toggle-back gesture the Apps sub-nav already uses.
                  onClick={() => (t.id === tab ? onClose() : onPick(t.id))}
                >
                  <Icon name={t.icon} size={13} />
                  <span>{t.label}</span>
                  {t.id === 'files' && changedCount !== undefined && changedCount > 0 && (
                    <b>{changedCount}</b>
                  )}
                </button>
              ))}
            </div>
            <span className="bench__tabs-end">
              {onToggleFull && (
                <button
                  type="button"
                  className="btn-quiet tip"
                  aria-label={isFull ? 'Exit full view' : 'Full view'}
                  aria-pressed={isFull}
                  data-testid="bench-full"
                  data-hotkey="view.workbenchFull"
                  data-tip={`${isFull ? 'Exit full view' : 'Full view'}  ${chordLabel('mod+shift+f')}`}
                  data-tip-side="left"
                  onClick={onToggleFull}
                >
                  <Icon name={isFull ? 'minimize' : 'maximize'} size={13} />
                </button>
              )}
              <button
                type="button"
                className="btn-quiet tip"
                aria-label="Collapse workbench"
                data-testid="bench-collapse"
                data-tip="Collapse"
                data-tip-side="left"
                onClick={onClose}
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </span>
          </div>
        </>
      )}

      {/* Only the active pane mounts, and only while open — see the header note
          about xterm measuring its width at mount. The browser, once started,
          stays (see the header note). */}
      <div className="bench__body">
        {tab === 'terminal' && <TerminalPane workspaceId={workspaceId} />}
        {tab === 'files' && <FilesPane workspaceId={workspaceId} cwd={active?.cwd ?? null} />}
        {tab === 'explorer' && <FilesExplorerPane workspaceId={workspaceId} />}
        {browserStarted && (
          <div
            className="bench__browser"
            data-shown={tab === 'browser'}
            aria-hidden={tab !== 'browser'}
            // Hidden at its real width so the pages keep their layout.
            style={tab === 'browser' ? undefined : { width }}
          >
            <BrowserPane workspaceId={workspaceId} />
          </div>
        )}
      </div>
    </aside>
  );
}
