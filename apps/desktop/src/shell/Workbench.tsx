/**
 * The workbench: the right-hand pane, as a TABBED workbench rather than a
 * drawer that shows one thing at a time.
 *
 * What this replaces: a rail whose contents were chosen from a dropdown in the
 * header, defaulted to fully collapsed, and contributed zero width when closed.
 * Three consequences, all fixed here:
 *
 *   1. You could not tell that a terminal and a diff both existed, let alone
 *      switch between them — picking one meant reopening a menu.
 *   2. Closed meant GONE. Nothing on screen said a workbench was available, so
 *      the panes were effectively undiscoverable. Closed now leaves a vertical
 *      tab strip, which is also how you reopen it.
 *   3. The changed-file count was invisible until you went looking for it. It
 *      is on the tab.
 *
 * Two constraints from the old rail are load-bearing and preserved:
 *
 *   - Width is NEVER transitioned. TerminalPane's xterm `fit()` measures at
 *     mount, and an animated width let it measure a sliver and lock the PTY to
 *     a couple of columns. Open/close is a snap; only the seam fades.
 *   - The active pane is mounted only while the workbench is open, so a pane
 *     never mounts into a zero-width box.
 */

import { useRef } from 'react';
import { deskForWorkspace, useDesks } from '@moxxy/client-core';
import { Icon, type IconName } from '@moxxy/desktop-ui';
import {
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
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
  browser_session: 'browser',
  terminal: 'terminal',
};

/** The workbench tab a given agent tool should reveal, or undefined if none. */
export function workbenchTabForTool(toolName: string): WorkbenchTab | undefined {
  return TOOL_TAB[toolName];
}

export function Workbench({
  tab,
  onPick,
  onClose,
  workspaceId,
  changedCount,
}: {
  /** Active tab, or null when the workbench is collapsed. */
  readonly tab: WorkbenchTab | null;
  readonly onPick: (tab: WorkbenchTab) => void;
  readonly onClose: () => void;
  readonly workspaceId: string | null;
  /** Badge on the Diff tab. Undefined while unknown (not a git repo, not
   *  loaded yet) so an unknown count never renders as a confident zero. */
  readonly changedCount?: number;
}): JSX.Element {
  const desks = useDesks();
  const active = deskForWorkspace(desks.desks, workspaceId);
  const width = useRailWidth();
  const ref = useRef<HTMLElement | null>(null);
  const open = tab !== null;

  // Drag the left edge to resize. The workbench is pinned to the window's right
  // edge, so width = (its right edge) − pointer x. Capture the right edge at
  // pointer-down so the maths survives the panel itself resizing mid-drag.
  const startDrag = (e: React.PointerEvent): void => {
    e.preventDefault();
    const right = ref.current?.getBoundingClientRect().right ?? window.innerWidth;
    const onMove = (ev: PointerEvent): void => setRailWidth(right - ev.clientX);
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Collapsed: a vertical strip of the same tabs. This is the whole fix for
  // "closed meant gone" — the workbench is always visible as an affordance, and
  // clicking any tab both opens it and selects that pane.
  if (!open) {
    return (
      <aside className="bench bench--closed" aria-label="Workbench">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="bench__stub tip"
            data-testid={`bench-open-${t.id}`}
            data-tip={`Open ${t.label}`}
            data-tip-side="left"
            aria-label={`Open ${t.label}`}
            onClick={() => onPick(t.id)}
          >
            <Icon name={t.icon} size={15} />
            {t.id === 'files' && changedCount !== undefined && changedCount > 0 && (
              <span className="bench__count">{changedCount}</span>
            )}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside ref={ref} className="bench" aria-label="Workbench" style={{ width }}>
      <div
        role="separator"
        aria-label="Resize workbench"
        aria-orientation="vertical"
        aria-valuemin={RAIL_MIN_WIDTH}
        aria-valuemax={RAIL_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startDrag}
        // The separator advertises slider semantics, so it must be operable
        // without a pointer. The panel grows leftward: ArrowLeft widens,
        // ArrowRight narrows, Home/End jump to the clamped extremes.
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 16;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setRailWidth(width + step);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setRailWidth(width - step);
          } else if (e.key === 'Home') {
            e.preventDefault();
            setRailWidth(RAIL_MAX_WIDTH);
          } else if (e.key === 'End') {
            e.preventDefault();
            setRailWidth(RAIL_MIN_WIDTH);
          }
        }}
        title="Drag to resize"
        className="bench__grip"
      />

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

      {/* Only the active pane mounts, and only while open — see the header note
          about xterm measuring its width at mount. */}
      <div className="bench__body">
        {tab === 'terminal' && <TerminalPane workspaceId={workspaceId} />}
        {tab === 'files' && <FilesPane workspaceId={workspaceId} cwd={active?.cwd ?? null} />}
        {tab === 'explorer' && <FilesExplorerPane workspaceId={workspaceId} />}
        {tab === 'browser' && <BrowserPane workspaceId={workspaceId} />}
      </div>
    </aside>
  );
}
