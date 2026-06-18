import { useEffect, useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { WorkspaceFiles, emitInsertPath } from '../WorkspaceFiles';
import { FileViewer } from './FileViewer';
import { FileMenu, Group, Hint, iconBtn, type MenuState } from './FilePaneShared';

interface Selected {
  readonly path: string;
  readonly label: string;
}

/**
 * The "Files" explorer pane: browse the entire workspace tree and preview any
 * file's contents. Unlike the git-centric "Files changed" pane this is always
 * available (no repo required) and every file opens its full content via
 * `workspace.readFile`. Clicking a file opens the shared menu to Add it to the
 * agent (attachment flow) or Open it in the viewer.
 */
export function FilesExplorerPane({
  workspaceId,
}: {
  readonly workspaceId: string | null;
}): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [reload, setReload] = useState(0);

  // Close the dropdown on any outside click / Escape (mirrors FilesPane).
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

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        // Side-by-side: file tree + content. Horizontal scroll kicks in only
        // when the rail is too narrow to fit both.
        overflow: 'hidden',
      }}
    >
      {/* Left: full workspace tree */}
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
        <Group
          title="Files"
          action={
            workspaceId ? (
              <button
                type="button"
                className="btn-icon"
                aria-label="Reload files"
                title="Reload files"
                onClick={() => setReload((k) => k + 1)}
                style={iconBtn}
              >
                <Icon name="rotate" size={12} />
              </button>
            ) : undefined
          }
        >
          {workspaceId ? (
            <WorkspaceFiles
              workspaceId={workspaceId}
              reloadSignal={reload}
              onPickFile={(detail, anchor) =>
                setMenu({ detail, changed: false, x: anchor.x, y: anchor.y })
              }
            />
          ) : (
            <Hint>Pick a workspace to browse its files.</Hint>
          )}
        </Group>
      </div>

      {/* Right: content viewer */}
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
          <FileViewer workspaceId={workspaceId} path={selected?.path ?? null} mode="content" />
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
            setSelected({ path: menu.detail.relPath, label: menu.detail.relPath });
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}
