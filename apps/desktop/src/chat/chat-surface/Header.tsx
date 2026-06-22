import { useState } from 'react';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Icon } from '@moxxy/desktop-ui';
import { ViewHeader, ViewSwitcher, type View } from '../../shell/ViewHeader';
import { RailMenu } from './RailMenu';
import { ModelSelectorButton } from '../agent-picker/ModelSelectorButton';
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
      {/* z.ai puts the model name top-left; the view switcher follows it. */}
      <ModelSelectorButton workspaceId={workspaceId} />
      <span style={{ width: 1, height: 22, background: 'var(--color-card-border)' }} />
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
      {/* Share opens the mobile/pairing flow (tunnel + QR live in Settings →
       *  Mobile); API jumps to the providers settings. */}
      <button
        type="button"
        data-testid="topbar-share"
        onClick={() => onView('settings')}
        title="Share this session to your phone"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          borderRadius: 9,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-main-bg)',
          background: 'var(--color-ink)',
          border: 'none',
        }}
      >
        <Icon name="send" size={14} />
        <span>Share</span>
      </button>
      <button
        type="button"
        className="btn-ghost"
        data-testid="topbar-api"
        onClick={() => onView('settings')}
        title="API & providers"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '7px 8px',
          borderRadius: 9,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          background: 'transparent',
        }}
      >
        <span>API</span>
        <span aria-hidden style={{ fontSize: 11 }}>↗</span>
      </button>
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
