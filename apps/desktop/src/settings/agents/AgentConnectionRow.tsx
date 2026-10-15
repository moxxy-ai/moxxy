import { Button, Icon } from '@moxxy/desktop-ui';
import type { AgentConnectionAction, AgentConnectionState } from '@moxxy/client-core';
import { PopoverMenu } from '../../shell/menu/PopoverMenu';
import { usePopover } from '../../shell/menu/usePopover';
import { Row, Tile } from '../settings-primitives';
import type { AgentConnectionRowModel } from './useAgentConnections';

const STATE: Record<AgentConnectionState, { readonly label: string; readonly tone?: 'good' | 'bad' | 'warn' }> = {
  checking: { label: 'Checking' },
  'not-installed': { label: 'Not installed', tone: 'warn' },
  installing: { label: 'Installing' },
  'install-failed': { label: 'Install failed', tone: 'bad' },
  'not-connected': { label: 'Not signed in', tone: 'warn' },
  connected: { label: 'Connected', tone: 'good' },
  'update-available': { label: 'Update available', tone: 'warn' },
  'update-required': { label: 'Update required', tone: 'bad' },
  unavailable: { label: 'Unavailable', tone: 'bad' },
};

/** What the button does, said with the agent's name for its accessible name. */
const ACTION_NAME: Record<AgentConnectionAction, string> = {
  install: 'Install',
  update: 'Update',
  'sign-in': 'Sign in to',
  check: 'Check',
};

function actionLabel(action: AgentConnectionAction, state: AgentConnectionState): string {
  if (action === 'install') return state === 'install-failed' ? 'Try again' : 'Install';
  if (action === 'update') return 'Update';
  if (action === 'sign-in') return 'Sign in';
  return 'Check again';
}

/**
 * One agent connection (Claude, Codex, OpenCode): its state as a chip, the one
 * action that moves it on, and a menu that checks for updates. While its CLI
 * installs or updates, a bar under the line says how far it got.
 */
export function AgentConnectionRow({
  row,
  onAction,
  onCheck,
  onConfigure,
}: {
  readonly row: AgentConnectionRowModel;
  readonly onAction: (action: AgentConnectionAction) => void;
  readonly onCheck: () => void;
  /** Opens its sign-in and settings; without it the menu leaves that out. */
  readonly onConfigure?: () => void;
}): JSX.Element {
  const { entry, view, jobAction } = row;
  const agent = entry.agentName ?? entry.name;
  const menu = usePopover<HTMLButtonElement, HTMLDivElement>({ side: 'bottom', align: 'end', width: 220 });
  const state = view.state === 'installing' && jobAction === 'update' ? { label: 'Updating' } : STATE[view.state];
  const doing = jobAction === 'update' ? 'Updating' : 'Installing';
  return (
    <Row
      testId={`agent-row-${entry.name}`}
      tile={
        <Tile bg="var(--color-input-soft)" fg="var(--color-text)">
          {agent.slice(0, 1).toUpperCase()}
        </Tile>
      }
      title={agent}
      subtitle={view.detail}
      below={
        view.state === 'installing' ? (
          <div
            role="progressbar"
            aria-label={`${doing} ${agent}`}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(view.progress !== null ? { 'aria-valuenow': Math.round(view.progress * 100) } : {})}
            className="agent-progress"
            data-indeterminate={view.progress === null || undefined}
          >
            <div className="agent-progress__fill" style={view.progress !== null ? { transform: `scaleX(${view.progress})` } : undefined} />
          </div>
        ) : null
      }
      trailing={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {entry.active && <span className="tag">Active</span>}
          <span className="tag" {...(state.tone ? { 'data-tone': state.tone } : {})}>
            {state.label}
          </span>
          {view.action && (
            <Button
              variant={view.action === 'check' ? 'secondary' : 'primary'}
              aria-label={`${ACTION_NAME[view.action]} ${agent}`}
              onClick={() => onAction(view.action ?? 'check')}
            >
              {actionLabel(view.action, view.state)}
            </Button>
          )}
          <button
            ref={menu.anchorRef}
            type="button"
            className="btn-quiet"
            aria-label={`More for ${agent}`}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            onClick={menu.toggle}
          >
            <Icon name="more" size={16} />
          </button>
          <PopoverMenu
            popover={menu}
            label={`More for ${agent}`}
            entries={[
              {
                id: 'check',
                label: 'Check for updates',
                icon: 'rotate',
                disabled: view.state === 'installing',
                onSelect: () => {
                  menu.close();
                  onCheck();
                },
              },
              ...(onConfigure
                ? [
                    {
                      id: 'configure',
                      label: 'Sign-in and settings',
                      icon: 'sliders' as const,
                      onSelect: () => {
                        menu.close();
                        onConfigure();
                      },
                    },
                  ]
                : []),
            ]}
          />
        </span>
      }
    />
  );
}
