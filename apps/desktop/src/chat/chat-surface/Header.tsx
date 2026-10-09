import { useState } from 'react';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Icon } from '@moxxy/desktop-ui';
import { chordLabel } from '@/hotkeys/chordLabel';
import { BarButton } from '../../shell/BarButton';
import { InstrumentBar, StatePill, type RunState } from '../../shell/InstrumentBar';
import { PanelIcon } from '../../shell/PanelIcon';
import { Telemetry } from '../../shell/instrument/Telemetry';
import { PopoverMenu } from '../../shell/menu/PopoverMenu';
import { usePopover } from '../../shell/menu/usePopover';
import { SessionAvatar } from '../../shell/workspace-sidebar/SessionAvatar';
import type { AgentSession } from '../agent-picker/useAgentSession';
import { useFocusModeToggle } from './useFocusModeToggle';

/** States worth interrupting the header for. An idle or finished run needs nothing. */
const LOUD_STATES: ReadonlySet<RunState> = new Set(['running', 'awaiting', 'failed']);

const MENU_WIDTH = 220;

/** A voice conversation with this chat, for the chats that can hold one. */
export interface VoiceControl {
  /** A conversation is open. */
  readonly active: boolean;
  /** A new conversation cannot start now; one that is open can still end. */
  readonly disabled: boolean;
  readonly onToggle: () => void;
}

/** The work panel beside this chat, for the chats that have one. */
export interface WorkPanelControl {
  readonly open: boolean;
  readonly onToggle: () => void;
}

/**
 * The run's header.
 *
 * It names the run and otherwise keeps quiet, so the conversation under it is
 * the main thing on screen. On the right: the model and its usage, then the two
 * ways of working with the run that change the whole window (a voice
 * conversation, focus mode), the work panel, and one control for the rest
 * (search, rename). The run's state shows only when it is something to act on.
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
  workPanel,
  voice,
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
  readonly workPanel?: WorkPanelControl;
  readonly voice?: VoiceControl;
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
          {voice && (
            <BarButton
              label={voice.active ? 'End voice conversation' : 'Start voice conversation'}
              tip={voice.active ? 'End voice conversation' : 'Voice conversation'}
              pressed={voice.active}
              live={voice.active}
              disabled={voice.disabled && !voice.active}
              testId="voice-toggle"
              onClick={voice.onToggle}
            >
              <Icon name={voice.active ? 'phone-down' : 'phone'} size={16} />
            </BarButton>
          )}
          <BarButton label="Focus mode" tip="Focus mode" testId="focus-toggle" onClick={toggleFocusMode}>
            <Icon name="focus" size={16} />
          </BarButton>
          {workPanel && (
            <BarButton
              label={workPanel.open ? 'Hide work panel' : 'Show work panel'}
              tip={`${workPanel.open ? 'Hide' : 'Show'} work panel  ${chordLabel('mod+j')}`}
              pressed={workPanel.open}
              testId="work-panel-toggle"
              hotkey="view.workbench"
              onClick={workPanel.onToggle}
            >
              <PanelIcon side="right" size={16} />
            </BarButton>
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
