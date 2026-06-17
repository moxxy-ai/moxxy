import { useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { WorkspaceFiles, emitInsertPath, type FileInsertDetail } from '../WorkspaceFiles';
import { FileViewer, type FileViewMode } from './FileViewer';

interface ChangedFile {
  readonly path: string;
  readonly status: string;
}

interface MenuState {
  readonly detail: FileInsertDetail;
  /** True when the file is git-changed (Open shows a diff, not content). */
  readonly changed: boolean;
  readonly x: number;
  readonly y: number;
}

interface Selected {
  readonly path: string;
  readonly mode: FileViewMode;
  readonly label: string;
}

/**
 * The "Files changed" pane: git-changed files first (with a diff on the right),
 * plus the full workspace tree for browsing. Clicking any file opens a dropdown
 * to Add it to the agent (the existing attachment flow) or Open it (diff for a
 * changed file, full content otherwise).
 */
export function FilesPane({
  workspaceId,
  cwd,
}: {
  readonly workspaceId: string | null;
  readonly cwd: string | null;
}): JSX.Element {
  const [isRepo, setIsRepo] = useState(false);
  const [changed, setChanged] = useState<ReadonlyArray<ChangedFile>>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const repo = await api().invoke('git.isRepo', { workspaceId });
        if (cancelled) return;
        setIsRepo(repo);
        if (repo) {
          const files = await api().invoke('git.status', { workspaceId });
          if (!cancelled) setChanged(files);
        } else {
          setChanged([]);
        }
      } catch {
        if (!cancelled) {
          setIsRepo(false);
          setChanged([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, reload]);

  // Close the dropdown on any outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const detailFor = (relPath: string, name: string): FileInsertDetail => ({
    relPath,
    absPath: cwd ? `${cwd.replace(/\/+$/, '')}/${relPath}` : relPath,
    name,
  });

  const openMenu = (detail: FileInsertDetail, changedFile: boolean, x: number, y: number): void => {
    setMenu({ detail, changed: changedFile, x, y });
  };

  const changedPaths = new Set(changed.map((c) => c.path));

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        // Side-by-side: file list + diff/content. Horizontal scroll kicks in
        // only when the rail is too narrow to fit both.
        overflow: 'hidden',
      }}
    >
      {/* Left: file list */}
      <div
        style={{
          width: 200,
          minWidth: 160,
          flexShrink: 0,
          overflowY: 'auto',
          borderRight: '1px solid var(--color-card-border)',
          padding: '8px 6px',
        }}
      >
        {isRepo && (
          <Group
            title="Changed"
            action={
              <button
                type="button"
                className="btn-icon"
                aria-label="Reload git status"
                onClick={() => setReload((k) => k + 1)}
                style={iconBtn}
              >
                <Icon name="rotate" size={12} />
              </button>
            }
          >
            {changed.length === 0 ? (
              <Hint>No changes.</Hint>
            ) : (
              changed.map((f) => (
                <ChangedRow
                  key={f.path}
                  file={f}
                  active={selected?.path === f.path}
                  onClick={(e) =>
                    openMenu(detailFor(f.path, f.path.split('/').pop() ?? f.path), true, e.clientX, e.clientY)
                  }
                />
              ))
            )}
          </Group>
        )}
        {workspaceId && (
          <Group title={isRepo ? 'All files' : 'Files'}>
            <WorkspaceFiles
              workspaceId={workspaceId}
              reloadSignal={reload}
              onPickFile={(detail, anchor) =>
                openMenu(detail, changedPaths.has(detail.relPath), anchor.x, anchor.y)
              }
            />
          </Group>
        )}
      </div>

      {/* Right: diff / content viewer */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selected && (
          <div
            className="mono"
            title={selected.label}
            style={{
              padding: '6px 10px',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              borderBottom: '1px solid var(--color-card-border)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexShrink: 0,
            }}
          >
            {selected.label}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, padding: 6 }}>
          <FileViewer workspaceId={workspaceId} path={selected?.path ?? null} mode={selected?.mode ?? 'content'} />
        </div>
      </div>

      {menu && (
        <FileMenu
          menu={menu}
          onAdd={() => {
            emitInsertPath(menu.detail);
            setMenu(null);
          }}
          onOpen={() => {
            setSelected({
              path: menu.detail.relPath,
              mode: menu.changed ? 'diff' : 'content',
              label: menu.detail.relPath,
            });
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

function FileMenu({
  menu,
  onAdd,
  onOpen,
}: {
  readonly menu: MenuState;
  readonly onAdd: () => void;
  readonly onOpen: () => void;
}): JSX.Element {
  // Anchor at the click; clamp to viewport so it never overflows off-screen.
  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - 96);
  return (
    <div
      role="menu"
      // Stop the window mousedown-to-close from firing for clicks inside.
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 50,
        minWidth: 184,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 4,
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 12,
        boxShadow: '0 18px 40px -22px rgba(15, 23, 42, 0.45)',
      }}
    >
      <MenuItem icon="attach" label="Add to agent" onClick={onAdd} />
      <MenuItem icon={menu.changed ? 'diff' : 'file'} label={menu.changed ? 'Open diff' : 'Open'} onClick={onOpen} />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  readonly icon: 'attach' | 'file' | 'diff';
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="row-button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 9px',
        borderRadius: 8,
        fontSize: 12.5,
        color: 'var(--color-text)',
        textAlign: 'left',
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

function ChangedRow({
  file,
  active,
  onClick,
}: {
  readonly file: ChangedFile;
  readonly active: boolean;
  readonly onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-button"
      title={file.path}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '4px 6px',
        borderRadius: 6,
        fontSize: 12,
        textAlign: 'left',
        background: active ? 'var(--color-primary-soft)' : undefined,
      }}
    >
      <span
        className="mono"
        aria-hidden
        style={{ width: 18, flexShrink: 0, color: statusColor(file.status), fontSize: 10.5 }}
      >
        {file.status.trim() || '•'}
      </span>
      <span
        className="mono"
        style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-muted)' }}
      >
        {file.path.split('/').pop()}
      </span>
    </button>
  );
}

function statusColor(status: string): string {
  const s = status.trim();
  if (s.includes('?')) return 'var(--color-text-dim)';
  if (s.includes('D')) return '#f7768e';
  if (s.includes('A')) return '#9ece6a';
  return '#7aa2f7';
}

function Group({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section style={{ marginBottom: 12 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--color-text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 6,
          padding: '0 4px',
        }}
      >
        <span>{title}</span>
        {action && (
          <>
            <span style={{ flex: 1 }} />
            {action}
          </>
        )}
      </header>
      {children}
    </section>
  );
}

function Hint({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return <div style={{ fontSize: 11, color: 'var(--color-text-dim)', padding: '2px 4px' }}>{children}</div>;
}

const iconBtn: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 6,
  color: 'var(--color-text-dim)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
