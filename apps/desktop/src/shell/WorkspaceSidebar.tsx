import { useState } from 'react';
import { useDesks } from '@moxxy/client-core';
import { Skeleton, Icon, ConfirmModal } from '@moxxy/desktop-ui';
import { useUnreadWorkspaces } from '@moxxy/client-core';
import type { Desk, DeskSession } from '@moxxy/desktop-ipc-contract';
import { Logo } from './workspace-sidebar/Logo';
import { PanelLeftIcon } from './PanelLeftIcon';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/useSidebarCollapsed';
import {
  toggleWorkspaceCollapsed,
  useWorkspaceCollapsed,
} from '@/lib/useWorkspaceCollapsed';
import { WorkspaceTree } from './workspace-sidebar/WorkspaceTree';
import { NameWorkspaceModal } from './workspace-sidebar/NameWorkspaceModal';
import { ProfilePill } from './workspace-sidebar/ProfilePill';
import type { View } from './ViewHeader';

interface Props {
  readonly view: View;
  readonly onView: (v: View) => void;
}

/**
 * Dark left rail. One scrolling tree of every workspace (a collapsible
 * folder row, [+] new-session on its right) with that workspace's
 * sessions nested beneath — see {@link WorkspaceTree}. Picking a session
 * anywhere foregrounds it (and its workspace); folder rows only fold.
 * Bottom: a lone Settings entry above the user-profile pill —
 * Chat/Workflows navigation lives in the main-pane header
 * (`ViewSwitcher`), not here.
 *
 * The whole rail collapses to nothing (Cmd/Ctrl+B, or the panel button
 * beside the logo); `ViewHeader` then shows the matching expand button
 * in the main pane, so the affordance never disappears with the rail.
 */
export function WorkspaceSidebar({ view, onView }: Props): JSX.Element | null {
  const collapsed = useSidebarCollapsed();
  const desks = useDesks();
  const foldedDesks = useWorkspaceCollapsed();
  const unread = new Set(useUnreadWorkspaces());
  const [busy, setBusy] = useState(false);
  /** Desk with a session-create in flight; null when idle. */
  const [sessionBusyDeskId, setSessionBusyDeskId] = useState<string | null>(null);
  /** Folder the user picked; null when no naming flow is in progress. */
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  /** Workspace queued for removal; null when no confirm is open. */
  const [pendingRemove, setPendingRemove] = useState<Desk | null>(null);
  /** Session queued for removal; null when no confirm is open. */
  const [pendingSessionRemove, setPendingSessionRemove] = useState<DeskSession | null>(null);

  // Collapsed = the rail contributes no width at all (it's text-first
  // now, so a mini icon rail would have nothing useful to show). All
  // hooks above ran, so the early return is hook-safe.
  if (collapsed) return null;

  const activeDesk = desks.desks.find((d) => d.id === desks.activeId) ?? null;

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

  const onNewSession = async (deskId: string): Promise<void> => {
    // ADD another conversation under that workspace (unlike `/new`, which
    // resets the current one in place) and foreground it right away.
    setSessionBusyDeskId(deskId);
    try {
      const session = await desks.createSession(deskId);
      if (session) await desks.setActiveSession(session.id);
    } finally {
      setSessionBusyDeskId(null);
    }
  };

  return (
    <aside className="col-sidebar">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Logo />
        </div>
        <button
          type="button"
          aria-label="Collapse sidebar"
          data-testid="sidebar-collapse"
          title="Collapse sidebar (⌘B / Ctrl+B)"
          onClick={() => setSidebarCollapsed(true)}
          className="row-button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 5,
            marginRight: 10,
            borderRadius: 8,
            color: 'var(--color-sidebar-text-dim)',
          }}
        >
          <PanelLeftIcon size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px' }}>
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
          <WorkspaceTree
            desks={desks.desks}
            activeDeskId={desks.activeId}
            activeSessionId={activeDesk?.activeSessionId ?? null}
            unread={unread}
            collapsed={foldedDesks}
            busyDeskId={sessionBusyDeskId}
            newWorkspaceBusy={busy}
            onToggleCollapse={toggleWorkspaceCollapsed}
            onSelectSession={(id) => {
              // Picking a session always lands on its chat — also the way
              // back out of Settings/Workflows now that the sidebar carries
              // no Chat entry. Cross-desk picks activate that desk too.
              void desks.setActiveSession(id);
              onView('chat');
            }}
            onCreateSession={(deskId) => {
              void onNewSession(deskId);
              onView('chat');
            }}
            onRenameSession={(id, name) => void desks.renameSession(id, name)}
            onRemoveSession={(s) => setPendingSessionRemove(s)}
            onRenameWorkspace={(id, name) => void desks.rename(id, name)}
            onRemoveWorkspace={(d) => setPendingRemove(d)}
            onNewWorkspace={() => void onStartNewWorkspace()}
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
            void desks.removeSession(pendingSessionRemove.id);
            setPendingSessionRemove(null);
          }}
        />
      )}
    </aside>
  );
}
