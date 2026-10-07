import { useState } from 'react';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Icon } from '@moxxy/desktop-ui';
import { chordLabel } from '@/hotkeys/chordLabel';
import { InstrumentBar, StatePill, type RunState } from '../../shell/InstrumentBar';
import { Telemetry } from '../../shell/instrument/Telemetry';
import { PopoverMenu } from '../../shell/menu/PopoverMenu';
import { usePopover } from '../../shell/menu/usePopover';
import { SessionAvatar } from '../../shell/workspace-sidebar/SessionAvatar';
import type { AgentSession } from '../agent-picker/useAgentSession';
import { useFocusModeToggle } from './useFocusModeToggle';

/** States worth interrupting the header for. An idle or finished run needs nothing. */
const LOUD_STATES: ReadonlySet<RunState> = new Set(['running', 'awaiting', 'failed']);

const MENU_WIDTH = 220;

/**
 * The run's header.
 *
 * It names the run and otherwise keeps quiet, so the conversation under it is
 * the main thing on screen. The model and its usage are one click away on the
 * right; search, focus mode and rename sit behind one control. The run's state
 * shows only when it is something to act on.
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
  /** Workspace name: the context half of the title. */
  readonly deskName: string | null;
  /** Foreground session name: the subject half. */
  readonly sessionName: string | null;
  readonly runState: RunState;
  readonly agent: AgentSession;
  /** Model picking is blocked while the session is not ready. */
  readonly agentDisabled: boolean;
  /** The session id the runner routes by. */
  readonly workspaceId: string;
  readonly searchQuery: string | null;
  readonly onSearchChange: (q: string | null) => void;
  readonly canRename: boolean;
  readonly onRename: () => void;
}): JSX.Element {
  const [searchOpen, setSearchOpen] = useState(searchQuery !== null);
  // A live query forces the field open, so the ⌘F shortcut (which sets the
  // query from outside this component) reveals and focuses it.
  const searching = searchOpen || searchQuery !== null;
  const toggleFocusMode = useFocusModeToggle();
  const menu = usePopover<HTMLButtonElement, HTMLDivElement>({
    side: 'bottom',
    align: 'end',
    width: MENU_WIDTH,
  });
  const crumbs = [deskName, sessionName].filter((c): c is string => Boolean(c));
  const closeSearch = (): void => {
    onSearchChange(null);
    setSearchOpen(false);
  };

  return (
    <InstrumentBar
      lead={sessionName ? <SessionAvatar id={workspaceId} name={sessionName} size="bar" /> : null}
      crumbs={crumbs.length > 0 ? crumbs : ['No workspace']}
      state={LOUD_STATES.has(runState) ? <StatePill state={runState} /> : null}
    >
      {searching ? (
        <div className="chat-search">
          <input
            autoFocus
            type="search"
            aria-label="Search this run"
            placeholder="Search this run…"
            value={searchQuery ?? ''}
            onChange={(e) => onSearchChange(e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch();
            }}
          />
          <button type="button" className="btn-quiet" aria-label="Close search" onClick={closeSearch}>
            <Icon name="x" size={15} />
          </button>
        </div>
      ) : (
        <>
          {agent.info && (
            <Telemetry
              workspaceId={workspaceId}
              info={agent.info}
              selectedModel={agent.selectedModel}
              disabled={agentDisabled}
              onPick={agent.onPickProviderModel}
            />
          )}
          <button
            ref={menu.anchorRef}
            type="button"
            className="btn-quiet"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menu.open}
            onClick={menu.toggle}
          >
            <Icon name="more" size={17} />
          </button>
          <PopoverMenu
            popover={menu}
            label="More actions"
            entries={[
              {
                id: 'search',
                label: 'Search this run',
                icon: 'search',
                hint: chordLabel('mod+f'),
                onSelect: () => setSearchOpen(true),
              },
              { id: 'focus', label: 'Focus mode', icon: 'focus', onSelect: toggleFocusMode },
              {
                id: 'rename',
                label: 'Rename workspace',
                icon: 'pencil',
                disabled: !canRename,
                onSelect: onRename,
              },
            ]}
          />
        </>
      )}
    </InstrumentBar>
  );
}
