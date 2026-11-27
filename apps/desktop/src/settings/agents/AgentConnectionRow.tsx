import { Button, Icon } from '@moxxy/desktop-ui';
import type { AgentConnectionAction, AgentConnectionState } from '@moxxy/client-core';
import { PopoverMenu } from '../../shell/menu/PopoverMenu';
import { usePopover } from '../../shell/menu/usePopover';
import { Row, Tile } from '../settings-primitives';
import type { AgentConnectionRowModel } from './useAgentConnections';
import { formatElapsed, useElapsedSeconds } from './useElapsedSeconds';

/** After this long without an end, the row says a slow network can take longer. */
export const SLOW_RUN_SECONDS = 45;

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
 * One agent connection (Claude, Codex, OpenCode): its state as a chip beside its name, the one
 * action that moves it on, and a menu with its sign-in and settings and, once
 * signed in, a sign-out. Checking for updates sits on the group's heading. While
 * its CLI installs or updates, a bar under the line says how far it got; a
 * failed install says why in a note under it.
 */
export function AgentConnectionRow({
  row,
  onAction,
  onConfigure,
  onSignOut,
}: {
  readonly row: AgentConnectionRowModel;
  readonly onAction: (action: AgentConnectionAction) => void;
  /** Opens its sign-in and settings; without it the menu leaves that out. */
  readonly onConfigure?: () => void;
  /** Asks to sign out; offered only while the agent is signed in. */
  readonly onSignOut?: () => void;
}): JSX.Element {
  const { entry, view, jobAction } = row;
  const agent = entry.agentName ?? entry.name;
  const menu = usePopover<HTMLButtonElement, HTMLDivElement>({ side: 'bottom', align: 'end', width: 220 });
  const state = view.state === 'installing' && jobAction === 'update' ? { label: 'Updating' } : STATE[view.state];
  const doing = jobAction === 'update' ? 'Updating' : 'Installing';
  const elapsed = useElapsedSeconds(view.state === 'installing');
  const failed = view.state === 'install-failed';
  return (
    <Row
      testId={`agent-row-${entry.name}`}
      tile={
        <Tile bg="var(--color-input-soft)" fg="var(--color-text)">
          {agent.slice(0, 1).toUpperCase()}
        </Tile>
      }
      title={agent}
      subtitle={failed ? `${agent} was not installed` : view.detail}
      badges={
        <>
          <span className="tag" {...(state.tone ? { 'data-tone': state.tone } : {})}>
            {state.label}
          </span>
          {entry.active && <span className="tag">Active</span>}
        </>
      }
      below={
        view.state === 'installing' ? (
          <RunProgress label={`${doing} ${agent}`} progress={view.progress} elapsed={elapsed} />
        ) : failed ? (
          <div role="note" aria-label={`Why ${agent} was not installed`} className="agent-note" data-tone="bad">
            <p className="agent-note__text">{view.detail}</p>
            {view.details && (
              <details className="agent-note__details">
                <summary>Show details</summary>
                <pre>{view.details}</pre>
              </details>
            )}
          </div>
        ) : null
      }
      trailing={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
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
              ...(onSignOut && row.signedIn
                ? [
                    {
                      id: 'sign-out',
                      label: 'Sign out',
                      icon: 'log-out' as const,
                      disabled: view.state === 'installing',
                      onSelect: () => {
                        menu.close();
                        onSignOut();
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

/**
 * A run's bar with how far it got beside it: the percentage when the installer
 * says one, else the time so far, so a long quiet download still shows it moves.
 */
function RunProgress({
  label,
  progress,
  elapsed,
}: {
  readonly label: string;
  readonly progress: number | null;
  readonly elapsed: number | null;
}): JSX.Element {
  const percent = progress !== null ? Math.round(progress * 100) : null;
  return (
    <div className="agent-run">
      <div className="agent-run__line">
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent !== null ? { 'aria-valuenow': percent } : {})}
          className="agent-progress"
          data-indeterminate={percent === null || undefined}
        >
          <div className="agent-progress__fill" style={progress !== null ? { transform: `scaleX(${progress})` } : undefined} />
        </div>
        <span className="agent-run__amount" aria-hidden="true">
          {percent !== null ? `${percent}%` : formatElapsed(elapsed ?? 0)}
        </span>
      </div>
      {elapsed !== null && elapsed >= SLOW_RUN_SECONDS && (
        <div className="agent-run__hint">A slow connection can take a few minutes.</div>
      )}
    </div>
  );
}
