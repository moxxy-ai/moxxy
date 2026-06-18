/**
 * Right-hand context rail — repurposed into a router for agentic surfaces.
 *
 * The chevron/context button no longer just toggles the rail; it opens a
 * dropdown (see {@link RailMenu}) to pick what the rail shows:
 *   - Terminal — a shared shell the user and the agent drive together.
 *   - Files changed — git-changed files with a diff (only in a git repo).
 *   - Files — browse + preview every file in the workspace (any folder).
 *   - Browser — a live, in-window view of the agent's browser.
 *
 * The rail is drag-resizable (left edge) and its width persists across
 * restarts (see {@link useRailWidth}).
 */

import { useRef } from 'react';
import { deskForWorkspace, useDesks } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { RAIL_MAX_WIDTH, RAIL_MIN_WIDTH, setRailWidth, useRailWidth } from '../lib/useRailWidth';
import { TerminalPane } from './surfaces/TerminalPane';
import { FilesPane } from './surfaces/FilesPane';
import { FilesExplorerPane } from './surfaces/FilesExplorerPane';
import { BrowserPane } from './surfaces/BrowserPane';

export type RailPane = 'terminal' | 'files' | 'explorer' | 'browser';

const PANE_TITLE: Record<RailPane, string> = {
  terminal: 'Terminal',
  files: 'Files changed',
  explorer: 'Files',
  browser: 'Browser',
};

interface Props {
  /** Active pane, or null when the rail is collapsed. */
  readonly pane: RailPane | null;
  readonly onClose: () => void;
  /** The workspace (session id) the rest of the UI is showing. */
  readonly workspaceId: string | null;
}

export function ContextRail({ pane, onClose, workspaceId }: Props): JSX.Element {
  const desks = useDesks();
  const active = deskForWorkspace(desks.desks, workspaceId);
  const width = useRailWidth();
  const railRef = useRef<HTMLElement | null>(null);
  const open = pane !== null;

  // Drag the left edge to resize. The rail is pinned to the window's right
  // edge, so width = (rail right edge) − pointer x. Capture the right edge at
  // pointer-down so the math survives the rail itself resizing mid-drag.
  const startDrag = (e: React.PointerEvent): void => {
    e.preventDefault();
    const right = railRef.current?.getBoundingClientRect().right ?? window.innerWidth;
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

  return (
    <section
      ref={railRef}
      className="col-rail col-rail--right"
      data-open={open}
      aria-hidden={!open}
      style={open ? { width } : undefined}
    >
      {open && (
        <div
          role="separator"
          aria-label="Resize panel"
          aria-orientation="vertical"
          aria-valuemin={RAIL_MIN_WIDTH}
          aria-valuemax={RAIL_MAX_WIDTH}
          aria-valuenow={width}
          onPointerDown={startDrag}
          title="Drag to resize"
          style={{
            // Sit just inside the rail's left edge. The rail clips horizontal
            // overflow (overflow-y:auto ⇒ overflow-x:auto), so a negative-left
            // handle would be clipped and unclickable; left:0 keeps the whole
            // grab strip live over the border.
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'col-resize',
            zIndex: 2,
          }}
        />
      )}

      <Header pane={pane} cwd={active?.cwd ?? null} onClose={onClose} />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {pane === 'terminal' && <TerminalPane workspaceId={workspaceId} />}
        {pane === 'files' && <FilesPane workspaceId={workspaceId} cwd={active?.cwd ?? null} />}
        {pane === 'explorer' && <FilesExplorerPane workspaceId={workspaceId} />}
        {pane === 'browser' && <BrowserPane workspaceId={workspaceId} />}
      </div>
    </section>
  );
}

function Header({
  pane,
  cwd,
  onClose,
}: {
  readonly pane: RailPane | null;
  readonly cwd: string | null;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 64,
        minHeight: 64,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: '0 14px',
        borderBottom: '1px solid var(--color-card-border)',
        background: 'var(--color-card-bg)',
      }}
    >
      <button type="button" aria-label="Collapse panel" onClick={onClose} style={iconBtnStyle}>
        <Icon name="chevron-right" size={14} />
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
          }}
        >
          {pane ? PANE_TITLE[pane] : 'Context'}
        </span>
        {cwd && (
          <span
            className="mono"
            title={cwd}
            style={{
              fontSize: 10.5,
              color: 'var(--color-text-dim)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {cwd}
          </span>
        )}
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 7,
  color: 'var(--color-text-dim)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--color-card-border)',
  background: 'var(--color-surface)',
  flexShrink: 0,
};
