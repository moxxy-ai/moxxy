/**
 * Workspace file browser in the right context rail.
 *
 * Lazy-loads one directory at a time via the workspace.listDir IPC.
 * Clicking a folder expands it inline; clicking a file inserts its
 * path as an `@<relative-path>` reference at the composer's cursor
 * (broadcast via a custom DOM event the Composer listens to).
 *
 * Defaults to the active workspace's cwd. Hidden + heavy directories
 * (node_modules, .git, dist, …) are filtered server-side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toErrorMessage } from '@moxxy/client-core';
import { api } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';

interface Entry {
  readonly name: string;
  readonly kind: 'file' | 'dir';
}

interface DirNode {
  readonly path: string;
  readonly entries: ReadonlyArray<Entry>;
  readonly loading: boolean;
  readonly error: string | null;
}

export const FILE_INSERT_EVENT = 'moxxy:insert-path';

export interface FileInsertDetail {
  /** Workspace-relative path (e.g. "src/index.ts"). */
  readonly relPath: string;
  /** Absolute path the agent should read. Joined client-side from the
   *  workspace's cwd so the listener doesn't need to plumb cwd. */
  readonly absPath: string;
  /** Basename for display. */
  readonly name: string;
}

/** Broadcast a path so the Composer can attach it to the current
 *  draft. Plain DOM event keeps the wiring decoupled from React refs
 *  / context. */
export function emitInsertPath(detail: FileInsertDetail): void {
  const ev = new CustomEvent(FILE_INSERT_EVENT, { detail });
  window.dispatchEvent(ev);
}

export function WorkspaceFiles({
  workspaceId,
  reloadSignal = 0,
  onPickFile,
}: {
  readonly workspaceId: string;
  /** Increment to re-read the root + every expanded folder (the rail's
   *  reload button) — picks up files the agent wrote / the user added. */
  readonly reloadSignal?: number;
  /** When provided, a file click calls this (the Files pane opens its
   *  Add-to-agent / Open dropdown) instead of immediately inserting the path. */
  readonly onPickFile?: (detail: FileInsertDetail, anchor: { x: number; y: number }) => void;
}): JSX.Element {
  const [cwd, setCwd] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, DirNode>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(['.']));
  // Mirror of `expanded` so the reload effect can read the current set without
  // doing side-effects inside a `setExpanded` updater (updaters must be pure;
  // StrictMode double-invokes them, which would double the listDir IPC calls).
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const load = useCallback(
    async (relPath: string): Promise<void> => {
      setNodes((cur) => ({
        ...cur,
        [relPath]: {
          path: relPath,
          entries: cur[relPath]?.entries ?? [],
          loading: true,
          error: null,
        },
      }));
      try {
        const result = await api().invoke('workspace.listDir', {
          workspaceId,
          path: relPath === '.' ? undefined : relPath,
        });
        // Stash the cwd reported by the IPC so we can build absolute
        // paths client-side when the user clicks a file. The cwd is
        // identical for every call so first response wins.
        setCwd((cur) => cur ?? result.cwd);
        setNodes((cur) => ({
          ...cur,
          [relPath]: {
            path: relPath,
            entries: result.entries,
            loading: false,
            error: null,
          },
        }));
      } catch (e) {
        setNodes((cur) => ({
          ...cur,
          [relPath]: {
            path: relPath,
            entries: cur[relPath]?.entries ?? [],
            loading: false,
            error: toErrorMessage(e),
          },
        }));
      }
    },
    [workspaceId],
  );

  // Always load the root on mount + when workspace changes.
  useEffect(() => {
    setNodes({});
    setExpanded(new Set(['.']));
    void load('.');
  }, [workspaceId, load]);

  // Re-read the root + currently-expanded folders when the rail asks for a
  // reload. `reloadSignal === 0` is the initial value, already covered above.
  useEffect(() => {
    if (reloadSignal === 0) return;
    void load('.');
    for (const p of expandedRef.current) if (p !== '.') void load(p);
  }, [reloadSignal, load]);

  const toggle = (relPath: string): void => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(relPath)) {
        next.delete(relPath);
      } else {
        next.add(relPath);
        if (!nodes[relPath]) void load(relPath);
      }
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <DirRow
        path="."
        level={0}
        expanded={expanded}
        nodes={nodes}
        onToggle={toggle}
        cwd={cwd}
        onPickFile={onPickFile}
      />
    </div>
  );
}

function DirRow({
  path,
  level,
  expanded,
  nodes,
  onToggle,
  cwd,
  onPickFile,
}: {
  readonly path: string;
  readonly level: number;
  readonly expanded: ReadonlySet<string>;
  readonly nodes: Record<string, DirNode>;
  readonly onToggle: (path: string) => void;
  readonly cwd: string | null;
  readonly onPickFile?: (detail: FileInsertDetail, anchor: { x: number; y: number }) => void;
}): JSX.Element {
  const node = nodes[path];
  const open = expanded.has(path);
  return (
    <>
      {path !== '.' && (
        <Row
          icon={
            <Icon
              name="chevron-right"
              size={11}
              style={{
                transform: open ? 'rotate(90deg)' : 'none',
                transition: 'transform 120ms ease',
              }}
            />
          }
          name={path.split('/').pop() ?? path}
          level={level}
          onClick={() => onToggle(path)}
          kind="dir"
        />
      )}
      {open && (
        <>
          {node?.loading && node.entries.length === 0 && (
            <LoadingRow level={level + 1} />
          )}
          {node?.error && (
            <ErrorRow message={node.error} level={level + 1} />
          )}
          {node?.entries.map((entry) => {
            const child = path === '.' ? entry.name : `${path}/${entry.name}`;
            if (entry.kind === 'dir') {
              return (
                <DirRow
                  key={child}
                  path={child}
                  level={path === '.' ? 0 : level + 1}
                  expanded={expanded}
                  nodes={nodes}
                  onToggle={onToggle}
                  cwd={cwd}
                  onPickFile={onPickFile}
                />
              );
            }
            return (
              <FileRow
                key={child}
                name={entry.name}
                path={child}
                level={path === '.' ? 0 : level + 1}
                cwd={cwd}
                onPickFile={onPickFile}
              />
            );
          })}
        </>
      )}
    </>
  );
}

function FileRow({
  name,
  path,
  level,
  cwd,
  onPickFile,
}: {
  readonly name: string;
  readonly path: string;
  readonly level: number;
  readonly cwd: string | null;
  readonly onPickFile?: (detail: FileInsertDetail, anchor: { x: number; y: number }) => void;
}): JSX.Element {
  return (
    <Row
      icon={<Icon name="copy" size={11} />}
      name={name}
      level={level}
      kind="file"
      title={path}
      onClick={(e) => {
        // Build the absolute path locally so the composer doesn't
        // need to know the workspace cwd. cwd is filled in on the
        // first listDir response; if for any reason it hasn't loaded
        // yet, fall back to the relative path (still usable as a
        // mention, the agent's cwd-rooted tools will resolve it).
        const absPath = cwd ? `${cwd.replace(/\/+$/, '')}/${path}` : path;
        const detail: FileInsertDetail = { relPath: path, absPath, name };
        // The Files pane opens a dropdown (Add to agent / Open); without a
        // handler, fall back to the original "click = insert" behavior.
        if (onPickFile) onPickFile(detail, { x: e.clientX, y: e.clientY });
        else emitInsertPath(detail);
      }}
    />
  );
}

function Row({
  icon,
  name,
  level,
  onClick,
  kind,
  title,
}: {
  readonly icon: React.ReactNode;
  readonly name: string;
  readonly level: number;
  readonly onClick: (e: React.MouseEvent) => void;
  readonly kind: 'file' | 'dir';
  readonly title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-button"
      title={title ?? name}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '4px 6px',
        paddingLeft: 6 + level * 12,
        borderRadius: 6,
        fontSize: 12,
        color: kind === 'dir' ? 'var(--color-text)' : 'var(--color-text-muted)',
        fontWeight: kind === 'dir' ? 600 : 500,
        textAlign: 'left',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          color: kind === 'dir' ? 'var(--color-primary-strong)' : 'var(--color-text-dim)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </span>
      <span
        className={kind === 'file' ? 'mono' : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </span>
    </button>
  );
}

function LoadingRow({ level }: { readonly level: number }): JSX.Element {
  return (
    <div
      style={{
        padding: '4px 6px',
        paddingLeft: 6 + level * 12,
        fontSize: 11,
        color: 'var(--color-text-dim)',
        fontStyle: 'italic',
      }}
    >
      Loading…
    </div>
  );
}

function ErrorRow({
  message,
  level,
}: {
  readonly message: string;
  readonly level: number;
}): JSX.Element {
  return (
    <div
      role="alert"
      title={message}
      style={{
        padding: '4px 6px',
        paddingLeft: 6 + level * 12,
        fontSize: 11,
        color: 'var(--color-red)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {message}
    </div>
  );
}
