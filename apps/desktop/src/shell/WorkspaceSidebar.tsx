import { useMemo, useState } from 'react';
import { useDesks } from '@moxxy/client-core';
import { Skeleton, Icon, ConfirmModal } from '@moxxy/desktop-ui';
import { useUnreadWorkspaces } from '@moxxy/client-core';
import type { Desk, DeskSession } from '@moxxy/desktop-ipc-contract';
import { IndexColumn } from './IndexColumn';
import {
  toggleWorkspaceCollapsed,
  useWorkspaceCollapsed,
} from '@/lib/useWorkspaceCollapsed';
import { WorkspaceTree } from './workspace-sidebar/WorkspaceTree';
import { NameWorkspaceModal } from './workspace-sidebar/NameWorkspaceModal';
import { RenameSidebarItemModal } from './workspace-sidebar/RenameSidebarItemModal';

interface Props {
  /** Lands on a session's run after picking it in the tree. */
  readonly onOpenRun: () => void;
}

/**
 * The Runs index: the contextual column beside the app rail, listing every
 * workspace as a collapsible folder row with its sessions nested beneath (see
 * {@link WorkspaceTree}). Picking a session anywhere foregrounds it and its
 * workspace; folder rows only fold.
 *
 * It no longer navigates. It used to end with Mobile and Settings entries while
 * Chat / Collaborate / Apps lived in a pill in the main-pane header, so the same
 * kind of decision was split across two organs. Every destination is in the app
 * rail now, and this column only ever answers "what is in here".
 *
 * Collapsing is unchanged (⌘B / Ctrl+B, or the button in the head): the column
 * contributes no width at all, and the instrument bar grows the expand button so
 * the affordance never disappears with it. {@link IndexColumn} owns that.
 */
export function WorkspaceSidebar({ onOpenRun }: Props): JSX.Element | null {
  const desks = useDesks();
  const foldedDesks = useWorkspaceCollapsed();
  // useUnreadWorkspaces returns a reference-stable array (the store caches it
  // until unread actually changes), so this Set is only re-allocated when the
  // unread set really changes — not on every sidebar re-render — keeping a
  // stable prop identity for WorkspaceTree.
  const unreadIds = useUnreadWorkspaces();
  const unread = useMemo(() => new Set(unreadIds), [unreadIds]);
  const [busy, setBusy] = useState(false);
  /** Desk with a session-create in flight; null when idle. */
  const [sessionBusyDeskId, setSessionBusyDeskId] = useState<string | null>(null);
  /** Folder the user picked; null when no naming flow is in progress. */
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  /** Workspace queued for removal; null when no confirm is open. */
  const [pendingRemove, setPendingRemove] = useState<Desk | null>(null);
  /** Workspace queued for rename; null when no rename modal is open. */
  const [pendingRename, setPendingRename] = useState<Desk | null>(null);
  /** Session queued for removal; null when no confirm is open. */
  const [pendingSessionRemove, setPendingSessionRemove] = useState<DeskSession | null>(null);
  /** Session queued for rename; null when no rename modal is open. */
  const [pendingSessionRename, setPendingSessionRename] = useState<DeskSession | null>(null);


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
    <IndexColumn title="runs">
      <>
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
              // back out of Settings/Apps now that the sidebar carries
              // no Chat entry. Cross-desk picks activate that desk too.
              void desks.setActiveSession(id);
              onOpenRun();
            }}
            onCreateSession={(deskId) => {
              void onNewSession(deskId);
              onOpenRun();
            }}
            onRenameSession={(s) => setPendingSessionRename(s)}
            onRemoveSession={(s) => setPendingSessionRemove(s)}
            onRenameWorkspace={(d) => setPendingRename(d)}
            onRemoveWorkspace={(d) => setPendingRemove(d)}
            onNewWorkspace={() => void onStartNewWorkspace()}
          />
        )}
      </>
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
      {pendingRename && (
        <RenameSidebarItemModal
          title="Rename workspace"
          defaultName={pendingRename.name}
          description="Choose a clear name for this workspace. Project files and sessions stay in place."
          onCancel={() => setPendingRename(null)}
          onSubmit={(name) => {
            void desks.rename(pendingRename.id, name);
            setPendingRename(null);
          }}
        />
      )}
      {pendingSessionRename && (
        <RenameSidebarItemModal
          title="Rename session"
          defaultName={pendingSessionRename.name}
          description="Choose a clear name for this conversation. Its full message history stays attached."
          onCancel={() => setPendingSessionRename(null)}
          onSubmit={(name) => {
            void desks.renameSession(pendingSessionRename.id, name);
            setPendingSessionRename(null);
          }}
        />
      )}
      {pendingSessionRemove && (
        <ConfirmModal
          title="Delete session?"
          message={`The session "${pendingSessionRemove.name}" and its conversation history will be deleted. Workspace files are not touched. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setPendingSessionRemove(null)}
          onConfirm={() => {
            void desks.removeSession(pendingSessionRemove.id);
            setPendingSessionRemove(null);
          }}
        />
      )}
    </IndexColumn>
  );
}
