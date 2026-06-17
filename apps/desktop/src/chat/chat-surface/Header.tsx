import { useState } from 'react';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Icon } from '@moxxy/desktop-ui';
import { ViewHeader, ViewSwitcher, type View } from '../../shell/ViewHeader';
import { RailMenu } from './RailMenu';
import type { RailPane } from '../../shell/ContextRail';

export function Header({
  phase: _phase,
  workspaceId,
  railPane,
  onPickPane,
  searchQuery,
  onSearchChange,
  canRename,
  onRename,
  onView,
}: {
  readonly phase: ConnectionPhase;
  readonly workspaceId: string;
  readonly railPane: RailPane | null;
  readonly onPickPane: (pane: RailPane) => void;
  readonly searchQuery: string | null;
  readonly onSearchChange: (q: string | null) => void;
  readonly canRename: boolean;
  readonly onRename: () => void;
  readonly onView: (v: View) => void;
}): JSX.Element {
  const [searchOpen, setSearchOpen] = useState(searchQuery !== null);
  return (
    <ViewHeader>
      <ViewSwitcher view="chat" onView={onView} />
      {/* workspace path lives in the right-hand context rail now */}
      <span style={{ flex: 1 }} />
      {searchOpen ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            autoFocus
            type="search"
            placeholder="Search transcript…"
            value={searchQuery ?? ''}
            onChange={(e) => onSearchChange(e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onSearchChange(null);
                setSearchOpen(false);
              }
            }}
            style={{
              padding: '6px 10px',
              fontSize: 13,
              color: 'var(--color-text)',
              border: '1px solid var(--color-card-border)',
              borderRadius: 8,
              background: 'var(--color-surface)',
              outline: 'none',
              width: 220,
            }}
          />
          <IconButton
            aria-label="Close search"
            onClick={() => {
              onSearchChange(null);
              setSearchOpen(false);
            }}
          >
            <Icon name="x" size={16} />
          </IconButton>
        </div>
      ) : (
        <IconButton aria-label="Search transcript" onClick={() => setSearchOpen(true)}>
          <Icon name="search" size={18} />
        </IconButton>
      )}
      <IconButton
        aria-label="Rename workspace"
        onClick={onRename}
        disabled={!canRename}
      >
        <Icon name="pencil" size={18} />
      </IconButton>
      <RailMenu workspaceId={workspaceId} current={railPane} onPick={onPickPane} />
    </ViewHeader>
  );
}

function IconButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      className="btn-icon"
      style={{
        width: 34,
        height: 34,
        borderRadius: 9,
        color: 'var(--color-text-muted)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
