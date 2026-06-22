/**
 * Right-hand embedded-window panel — a resizable host for "surfaces".
 *
 * The body and the rail/embed menu are driven by the surface registry
 * ({@link ./surfaces/registry}) so panes are pluggable: built-ins are
 * terminal / files-changed / files / browser / code-file, plus generic
 * web + text renderers any plugin surface can target. The header carries a
 * code↔preview toggle (file pane) and contextual actions — including
 * pane→agent actions (e.g. "Ask agent about this file") — plus Close.
 *
 * Drag the left edge (the ⋮ grip) to resize; the width persists
 * ({@link useRailWidth}). Width is intentionally NOT animated (xterm's fit()
 * would measure a sliver mid-animation and lock the terminal).
 */

import { useRef, useState } from 'react';
import { api, deskForWorkspace, useDesks } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { RAIL_MAX_WIDTH, RAIL_MIN_WIDTH, setRailWidth, useRailWidth } from '../lib/useRailWidth';
import {
  paneDef,
  renderPaneBody,
  type AgentLink,
  type FileSelection,
  type RailPane,
} from './surfaces/registry';
import type { FileSurfaceView } from './surfaces/FileSurface';
import { isPreviewable } from './surfaces/FilePreview';

export type { RailPane } from './surfaces/registry';

interface Props {
  /** Active pane, or null when the panel is collapsed. */
  readonly pane: RailPane | null;
  readonly onClose: () => void;
  /** The workspace (session id) the rest of the UI is showing. */
  readonly workspaceId: string | null;
  /** File revealed in the `file` pane (lifted in App). */
  readonly file: FileSelection;
  /** Pane → chat/agent channel. */
  readonly agent: AgentLink;
}

export function ContextRail({ pane, onClose, workspaceId, file, agent }: Props): JSX.Element {
  const desks = useDesks();
  const active = deskForWorkspace(desks.desks, workspaceId);
  const cwd = active?.cwd ?? null;
  const width = useRailWidth();
  const railRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<FileSurfaceView>('code');
  const open = pane !== null;

  const ctx = { workspaceId, cwd, file, view, setView, agent };

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
          tabIndex={0}
          onPointerDown={startDrag}
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
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'col-resize',
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-dim)',
          }}
        >
          <span aria-hidden style={{ fontSize: 12, lineHeight: 1, letterSpacing: '-2px', opacity: 0.6 }}>
            ⋮
          </span>
        </div>
      )}

      <Header
        pane={pane}
        cwd={cwd}
        file={file}
        view={view}
        onSetView={setView}
        onClose={onClose}
        onAsk={() => agent.ask(`About \`${baseName(file.path)}\`: `)}
        onEdit={() => agent.ask(`Please edit \`${baseName(file.path)}\`: `)}
        onOpenExternal={() => openExternal(cwd, file.path)}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: pane === 'file' ? 0 : undefined }}>
        {pane !== null && renderPaneBody(pane, ctx)}
      </div>
    </section>
  );
}

function Header({
  pane,
  cwd,
  file,
  view,
  onSetView,
  onClose,
  onAsk,
  onEdit,
  onOpenExternal,
}: {
  readonly pane: RailPane | null;
  readonly cwd: string | null;
  readonly file: FileSelection;
  readonly view: FileSurfaceView;
  readonly onSetView: (v: FileSurfaceView) => void;
  readonly onClose: () => void;
  readonly onAsk: () => void;
  readonly onEdit: () => void;
  readonly onOpenExternal: () => void;
}): JSX.Element {
  const def = paneDef(pane);
  const isFile = pane === 'file';
  const canPreview = isFile && isPreviewable(file.path);

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
        padding: '0 12px',
        borderBottom: '1px solid var(--color-card-border)',
        background: 'var(--color-card-bg)',
      }}
    >
      {isFile ? (
        <div
          style={{
            display: 'inline-flex',
            padding: 3,
            gap: 2,
            background: 'var(--color-app-bg)',
            borderRadius: 9,
          }}
        >
          <ToggleBtn active={view === 'code'} label="Code" onClick={() => onSetView('code')}>
            <Icon name="code" size={15} />
          </ToggleBtn>
          {canPreview && (
            <ToggleBtn active={view === 'preview'} label="Preview" onClick={() => onSetView('preview')}>
              <Icon name="eye" size={15} />
            </ToggleBtn>
          )}
        </div>
      ) : (
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
            {def?.title ?? 'Context'}
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
      )}

      <span style={{ flex: 1 }} />

      {isFile && (
        <>
          <ActBtn label="Ask agent about this file" onClick={onAsk}>
            <Icon name="chat" size={15} />
          </ActBtn>
          <ActBtn label="Ask the agent to edit this file" onClick={onEdit}>
            <Icon name="pencil" size={15} />
          </ActBtn>
          <ActBtn label="Open in default app" onClick={onOpenExternal}>
            <Icon name="external" size={15} />
          </ActBtn>
        </>
      )}
      <ActBtn label="Close panel" onClick={onClose}>
        <Icon name="x" size={15} />
      </ActBtn>
    </div>
  );
}

function ToggleBtn({
  active,
  label,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 26,
        borderRadius: 7,
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        background: active ? 'var(--color-surface)' : 'transparent',
        boxShadow: active ? '0 1px 2px rgba(24, 24, 27, 0.06)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function ActBtn({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button type="button" className="btn-icon" aria-label={label} title={label} onClick={onClick} style={iconBtnStyle}>
      {children}
    </button>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  color: 'var(--color-text-dim)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

function baseName(path: string | null): string {
  if (!path) return 'this file';
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** Best-effort "open in default app" via the existing external-open IPC. */
function openExternal(cwd: string | null, path: string | null): void {
  if (!path) return;
  const abs = path.startsWith('/') ? path : cwd ? `${cwd.replace(/\/$/, '')}/${path}` : path;
  void api()
    .invoke('onboarding.openExternal', { url: `file://${abs}` })
    .catch(() => {});
}
