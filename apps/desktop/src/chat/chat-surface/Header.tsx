import { useState } from 'react';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Icon } from '@moxxy/desktop-ui';
import { InstrumentBar, StatePill, type RunState } from '../../shell/InstrumentBar';
import { Telemetry } from '../../shell/instrument/Telemetry';
import type { AgentSession } from '../agent-picker/useAgentSession';
import { useFocusModeToggle } from './useFocusModeToggle';

/**
 * The Runs instrument bar.
 *
 * It used to lead with a Chat / Collaborate / Apps pill and say nothing about
 * what you were looking at — the workspace path had been pushed out to a
 * right-hand drawer. Navigation is the app rail's job now, so the bar does the
 * job a header should: identify the run (workspace / session), state what it is
 * doing, and carry its telemetry — the context window and token count that are
 * the whole reason you would intervene in an unattended run, and which used to
 * be chips inside the composer behind a click.
 */
export function Header({
  phase: _phase,
  deskName,
  sessionName,
  runState,
  agent,
  agentDisabled,
  workspaceId,
  searchQuery,
  onSearchChange,
  canRename,
  onRename,
}: {
  readonly phase: ConnectionPhase;
  /** Workspace name — the context half of the crumbs. */
  readonly deskName: string | null;
  /** Foreground session name — the subject half. */
  readonly sessionName: string | null;
  readonly runState: RunState;
  readonly agent: AgentSession;
  /** Model picking is blocked while the session is not ready. */
  readonly agentDisabled: boolean;
  readonly workspaceId: string;
  readonly searchQuery: string | null;
  readonly onSearchChange: (q: string | null) => void;
  readonly canRename: boolean;
  readonly onRename: () => void;
}): JSX.Element {
  const [searchOpen, setSearchOpen] = useState(searchQuery !== null);
  // A live query forces the field open, so the ⌘F shortcut (which sets the
  // query from outside this component) reveals and focuses it.
  const open = searchOpen || searchQuery !== null;
  const toggleFocusMode = useFocusModeToggle();
  const crumbs = [deskName, sessionName].filter((c): c is string => Boolean(c));
  return (
    <InstrumentBar
      crumbs={crumbs.length > 0 ? crumbs : ['No workspace']}
      state={<StatePill state={runState} />}
    >
      {agent.info && (
        <Telemetry
          workspaceId={workspaceId}
          info={agent.info}
          selectedModel={agent.selectedModel}
          disabled={agentDisabled}
          onPick={agent.onPickProviderModel}
        />
      )}
      {open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
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
              padding: '5px 8px',
              fontSize: 'var(--type-row)',
              fontFamily: 'inherit',
              color: 'var(--color-text)',
              border: '1px solid var(--color-card-border)',
              borderRadius: 'var(--radius-block)',
              background: 'var(--color-input-soft)',
              outline: 'none',
              width: 200,
            }}
          />
          <IconButton
            aria-label="Close search"
            onClick={() => {
              onSearchChange(null);
              setSearchOpen(false);
            }}
          >
            <Icon name="x" size={15} />
          </IconButton>
        </div>
      ) : (
        <IconButton aria-label="Search transcript" onClick={() => setSearchOpen(true)}>
          <Icon name="search" size={16} />
        </IconButton>
      )}
      <IconButton aria-label="Toggle focus mode" onClick={toggleFocusMode}>
        <Icon name="focus" size={16} />
      </IconButton>
      <IconButton aria-label="Rename workspace" onClick={onRename} disabled={!canRename}>
        <Icon name="pencil" size={16} />
      </IconButton>
    </InstrumentBar>
  );
}

function IconButton({
  children,
  title,
  'aria-label': ariaLabel,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      className="btn-quiet"
      aria-label={ariaLabel}
      title={title ?? (typeof ariaLabel === 'string' ? ariaLabel : undefined)}
      {...rest}
    >
      {children}
    </button>
  );
}
