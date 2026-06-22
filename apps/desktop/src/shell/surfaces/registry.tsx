/**
 * Renderer-side registry of embedded-window ("surface") panes.
 *
 * This is a CLOSED, AUDITED set of built-in renderers. Plugins extend the
 * embedded panel by registering RUNNER surfaces (see @moxxy/sdk `defineSurface`)
 * — they contribute DATA over the `surface.data` channel, never code that runs
 * in the privileged renderer. A plugin's surface is shown by mapping its kind to
 * one of the generic renderers here (`web` = sandboxed iframe, `text` = plain
 * monospace). This preserves the runner↔renderer trust boundary: no plugin code
 * loads in the renderer, and untrusted payloads are sandboxed / validated.
 *
 * Adding a built-in pane = one entry in {@link SURFACE_PANES} + one case in
 * {@link renderPaneBody}. The rail menu and the agent auto-reveal both read this
 * registry, so a new pane wires itself up everywhere.
 */

import type { ReactNode } from 'react';
import type { IconName } from '@moxxy/desktop-ui';
import { TerminalPane } from './TerminalPane';
import { FilesPane } from './FilesPane';
import { FilesExplorerPane } from './FilesExplorerPane';
import { BrowserPane } from './BrowserPane';
import { FileSurface, type FileSurfaceView } from './FileSurface';
import { WebPane } from './WebPane';
import { TextPane } from './TextPane';
import type { FileViewMode } from './FileViewer';

/** Built-in pane kinds plus an open string for plugin-contributed kinds. */
export type RailPane =
  | 'terminal'
  | 'files'
  | 'explorer'
  | 'browser'
  | 'file'
  | 'web'
  | 'text'
  | (string & {});

/** Pane → chat/agent channel: lets an embedded window feed the agent. */
export interface AgentLink {
  /** Stage text in the composer for the user to review/send. */
  ask(text: string): void;
  /** Submit a turn immediately. */
  send(text: string): void;
  /** Attach an artifact (image/file) to the composer. */
  attach(a: { mediaType: string; base64?: string; path?: string; name?: string }): void;
}

export interface FileSelection {
  readonly path: string | null;
  readonly mode: FileViewMode;
}

export interface SurfacePaneCtx {
  readonly workspaceId: string | null;
  readonly cwd: string | null;
  /** The file revealed in the `file` pane (auto-reveal / selection). */
  readonly file: FileSelection;
  /** Code↔preview toggle for the `file` pane. */
  readonly view: FileSurfaceView;
  readonly setView: (v: FileSurfaceView) => void;
  readonly agent: AgentLink;
}

export interface SurfacePaneDef {
  readonly kind: RailPane;
  readonly title: string;
  readonly icon: IconName;
  /** Appears in the rail/embed menu. */
  readonly menu: boolean;
  /** Only useful inside a git repo (Files changed). */
  readonly needsRepo?: boolean;
  /** Agent tool names that auto-reveal this pane. */
  readonly revealTools?: readonly string[];
}

export const SURFACE_PANES: readonly SurfacePaneDef[] = [
  { kind: 'terminal', title: 'Terminal', icon: 'terminal', menu: true, revealTools: ['terminal'] },
  { kind: 'files', title: 'Files changed', icon: 'diff', menu: true, needsRepo: true },
  { kind: 'explorer', title: 'Files', icon: 'folder', menu: true },
  { kind: 'browser', title: 'Browser', icon: 'globe', menu: true, revealTools: ['browser_session'] },
  { kind: 'file', title: 'Code', icon: 'code', menu: false, revealTools: ['Write', 'Edit'] },
  { kind: 'web', title: 'Preview', icon: 'eye', menu: false },
  { kind: 'text', title: 'Output', icon: 'file', menu: false },
];

export function paneDef(kind: RailPane | null): SurfacePaneDef | undefined {
  if (kind === null) return undefined;
  return SURFACE_PANES.find((p) => p.kind === kind);
}

/** The closed renderer set: kind → body. Unknown (plugin) kinds fall back to the
 *  generic sandboxed web renderer rather than failing. */
export function renderPaneBody(kind: RailPane, ctx: SurfacePaneCtx): ReactNode {
  switch (kind) {
    case 'terminal':
      return <TerminalPane workspaceId={ctx.workspaceId} />;
    case 'files':
      return <FilesPane workspaceId={ctx.workspaceId} cwd={ctx.cwd} />;
    case 'explorer':
      return <FilesExplorerPane workspaceId={ctx.workspaceId} />;
    case 'browser':
      return <BrowserPane workspaceId={ctx.workspaceId} />;
    case 'file':
      return (
        <FileSurface
          workspaceId={ctx.workspaceId}
          path={ctx.file.path}
          mode={ctx.file.mode}
          view={ctx.view}
        />
      );
    case 'web':
      return <WebPane workspaceId={ctx.workspaceId} kind="web" />;
    case 'text':
      return <TextPane workspaceId={ctx.workspaceId} kind="text" />;
    default:
      return <WebPane workspaceId={ctx.workspaceId} kind={kind} />;
  }
}

/** Registry-driven auto-reveal: which pane (+ file payload) an agent tool opens. */
export function revealForTool(
  toolName: string,
  input: unknown,
): { readonly kind: RailPane; readonly file?: FileSelection } | null {
  const def = SURFACE_PANES.find((p) => p.revealTools?.includes(toolName));
  if (!def) return null;
  if (def.kind === 'file') {
    const path = extractFilePath(input);
    if (!path) return null;
    // Edit → diff (file existed); Write → content (often a new file).
    const mode: FileViewMode = toolName === 'Edit' ? 'diff' : 'content';
    return { kind: 'file', file: { path, mode } };
  }
  return { kind: def.kind };
}

function extractFilePath(input: unknown): string | null {
  if (input && typeof input === 'object') {
    const fp = (input as Record<string, unknown>).file_path;
    if (typeof fp === 'string' && fp.length > 0) return fp;
  }
  return null;
}
