import { useState } from 'react';
import { useDesks, useSessions } from '@moxxy/client-core';
import { Skeleton, Icon, ConfirmModal } from '@moxxy/desktop-ui';
import { useUnreadWorkspaces } from '@moxxy/client-core';
import type { Desk, DeskSession } from '@moxxy/desktop-ipc-contract';
import { Logo } from './workspace-sidebar/Logo';
import { WorkspaceSwitcher } from './workspace-sidebar/WorkspaceSwitcher';
import { SessionList } from './workspace-sidebar/SessionList';
import { NameWorkspaceModal } from './workspace-sidebar/NameWorkspaceModal';
import { ProfilePill } from './workspace-sidebar/ProfilePill';
import type { View } from './ViewHeader';

interface Props {
  readonly view: View;
  readonly onView: (v: View) => void;
}

/**
 * Dark left rail. Top: a Slack/Linear-style workspace switcher card
 * (the active desk; a dropdown swaps/creates/removes workspaces).
 * Below it the active desk's sessions fill the rail as a flat list.
 * Bottom: a lone Settings entry above the user-profile pill —
 * Chat/Workflows navigation lives in the main-pane header
 * (`ViewSwitcher`), not here.
 */
export function WorkspaceSidebar({ view, onView }: Props): JSX.Element {
  const desks = useDesks();
  const sessions = useSessions(desks.activeId);
  const unread = new Set(useUnreadWorkspaces());
  const [busy, setBusy] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  /** Folder the user picked; null when no naming flow is in progress. */
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  /** Workspace queued for removal; null when no confirm is open. */
  const [pendingRemove, setPendingRemove] = useState<Desk | null>(null);
  /** Session queued for removal; null when no confirm is open. */
  const [pendingSessionRemove, setPendingSessionRemove] = useState<DeskSession | null>(null);

  // Unread is tracked per routing id — a session id. Light a desk's dot
  // when ANY of its sessions has activity (or its own id, the v1 alias).
  const unreadDeskIds = new Set(
    desks.desks
      .filter((d) => d.sessions.some((s) => unread.has(s.id)) || unread.has(d.id))
      .map((d) => d.id),
  );

  const onStartNewWorkspace = async (): Promise<void> => {
    setBusy(true);
    try {
      const folder = await desks.pickFolder();
      if (folder) setPendingFolder(folder);
    } finally {
      setBusy(false);
    }
  };

  const onCreateWorkspace = async (name: string): Promise<void> => {
    if (!pendingFolder) return;
    const folder = pendingFolder;
    setPendingFolder(null);
    const desk = await desks.create(name.trim(), folder);
    if (desk) await desks.setActive(desk.id);
  };

  const onNewSession = async (): Promise<void> => {
    // ADD another conversation (unlike `/new`, which resets the current
    // one in place) and foreground it right away.
    setSessionBusy(true);
    try {
      const session = await sessions.create();
      if (session) await sessions.setActive(session.id);
    } finally {
      setSessionBusy(false);
    }
  };

  return (
    <aside className="col-sidebar">
      <Logo />
      {/* The switcher lives OUTSIDE the scrolling session list so its
       *  dropdown never gets clipped by the overflow container and the
       *  card stays pinned while sessions scroll. */}
      <div style={{ padding: '4px 12px 0' }}>
        {desks.loading && desks.desks.length === 0 ? (
          <div style={{ padding: '8px 0' }}>
            <Skeleton.Row />
            <Skeleton.Row />
          </div>
        ) : desks.desks.length === 0 ? (
          <button
            type="button"
            data-testid="desk-new"
            onClick={() => void onStartNewWorkspace()}
            disabled={busy}
            className="row-button"
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              fontSize: 13,
              color: 'var(--color-sidebar-text-dim)',
              borderRadius: 10,
              opacity: busy ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span
              style={{
                width: 20,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="plus" size={16} />
            </span>
            {busy ? 'Picking folder…' : 'New workspace'}
          </button>
        ) : (
          <WorkspaceSwitcher
            desks={desks.desks}
            activeDeskId={desks.activeId}
            unreadDeskIds={unreadDeskIds}
            sessionCount={sessions.sessions.length}
            busy={busy}
            onSelect={(id) => {
              // Picking a workspace always lands on its chat — also the
              // way back out of Settings/Workflows now that the sidebar
              // carries no Chat entry.
              void desks.setActive(id);
              onView('chat');
            }}
            onRemove={(d) => setPendingRemove(d)}
            onNewWorkspace={() => void onStartNewWorkspace()}
          />
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px 12px' }}>
        {desks.desks.length > 0 && (
          <SessionList
            sessions={sessions.sessions}
            activeSessionId={sessions.activeSessionId}
            unread={unread}
            busy={sessionBusy}
            onSelect={(id) => {
              void sessions.setActive(id);
              onView('chat');
            }}
            onCreate={() => {
              void onNewSession();
              onView('chat');
            }}
            onRename={(id, name) => void sessions.rename(id, name)}
            onRemove={(s) => setPendingSessionRemove(s)}
          />
        )}
      </div>
      {/* Settings is the only sidebar destination — anchored just above
       *  the profile's top border. Chat/Workflows switch in the main-pane
       *  header instead. */}
      <nav style={{ padding: '6px 12px 10px' }}>
        <button
          type="button"
          data-testid="nav-settings"
          data-active={view === 'settings'}
          onClick={() => onView('settings')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '10px 12px',
            fontSize: 13.5,
            color:
              view === 'settings'
                ? 'var(--color-sidebar-text)'
                : 'var(--color-sidebar-text-dim)',
            background:
              view === 'settings' ? 'var(--color-sidebar-bg-active)' : 'transparent',
            borderRadius: 10,
            fontWeight: view === 'settings' ? 600 : 500,
          }}
        >
          <span
            style={{
              width: 20,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.85,
            }}
          >
            <Icon name="settings" size={17} />
          </span>
          <span>Settings</span>
        </button>
      </nav>
      <ProfilePill />
      {pendingFolder && (
        <NameWorkspaceModal
          defaultName={pendingFolder.split('/').filter(Boolean).pop() ?? 'New workspace'}
          folder={pendingFolder}
          onCancel={() => setPendingFolder(null)}
          onSubmit={(name) => void onCreateWorkspace(name)}
        />
      )}
      {pendingRemove && (
        <ConfirmModal
          title="Remove workspace?"
          message={`The workspace "${pendingRemove.name}" will disappear from the sidebar. Files in ${pendingRemove.cwd} are not touched.`}
          confirmLabel="Remove"
          destructive
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            void desks.remove(pendingRemove.id);
            setPendingRemove(null);
          }}
        />
      )}
      {pendingSessionRemove && (
        <ConfirmModal
          title="Delete session?"
          message={`The session "${pendingSessionRemove.name}" and its conversation history will be deleted. Workspace files are not touched.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setPendingSessionRemove(null)}
          onConfirm={() => {
            void sessions.remove(pendingSessionRemove.id);
            setPendingSessionRemove(null);
          }}
        />
      )}
    </aside>
  );
}
