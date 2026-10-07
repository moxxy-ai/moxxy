import { useMemo, useState } from 'react';
import { useDesks } from '@moxxy/client-core';
import { useNow } from '@/lib/useNow';
import { Skeleton, Icon, ConfirmModal } from '@moxxy/desktop-ui';
import { useUnreadWorkspaces } from '@moxxy/client-core';
import type { Desk, DeskSession } from '@moxxy/desktop-ipc-contract';
import { IndexColumn } from './IndexColumn';
import {
  toggleWorkspaceCollapsed,
  useWorkspaceCollapsed,
} from '@/lib/useWorkspaceCollapsed';
import { WorkspaceTree } from './workspace-sidebar/WorkspaceTree';
import { filterDesks } from './workspace-sidebar/filter-desks';
import { sessionPreview } from './workspace-sidebar/session-preview';
import { useLiveSessions } from './workspace-sidebar/useLiveSessions';
import { NameWorkspaceModal } from './workspace-sidebar/NameWorkspaceModal';
import { RenameSidebarItemModal } from './workspace-sidebar/RenameSidebarItemModal';
import { SidebarChannelsSection } from './SidebarChannels';

/** Stable empty set: while filtering every folder is force-expanded, and a fresh
 *  Set per render would hand WorkspaceTree a new prop identity every time. */
const NO_COLLAPSED: ReadonlySet<string> = new Set();

interface Props {
  /** Lands on a session's run after picking it in the tree. */
  readonly onOpenRun: () => void;
  /** Opens a channel bot's page (its conversation, run mode, model). */
  readonly onOpenChannel?: (channelId: string) => void;
}

/**
 * The run list: every workspace as a section, its runs beneath it (see
 * {@link WorkspaceTree}). Picking a run anywhere foregrounds it and its
 * workspace; section headers only fold.
 *
 * It does not navigate. Every other place in the app is reached from the
 * account row that {@link IndexColumn} puts under this list.
 */
export function WorkspaceSidebar({ onOpenRun, onOpenChannel }: Props): JSX.Element | null {
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
  /** Free-text filter over the list; empty when not filtering. */
  const [query, setQuery] = useState('');
  const now = useNow();

  const sessions = useMemo(() => desks.desks.flatMap((d) => d.sessions), [desks.desks]);
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const live = useLiveSessions(sessionIds);
  const previews = useMemo(() => {
    const lines = new Map<string, string>();
    for (const session of sessions) {
      const line = sessionPreview(session, live.latest.get(session.id) ?? null);
      if (line) lines.set(session.id, line);
    }
    return lines;
  }, [sessions, live.latest]);

  const activeDesk = desks.desks.find((d) => d.id === desks.activeId) ?? null;
  const filtering = query.trim().length > 0;
  const visibleDesks = filtering ? filterDesks(desks.desks, query) : desks.desks;

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
    <IndexColumn
      title="runs"
      actions={
        <button
          type="button"
          data-testid="session-new"
          aria-label="New session"
          className="btn-quiet tip"
          data-tip="New session"
          data-tip-side="bottom"
          disabled={activeDesk === null || sessionBusyDeskId !== null}
          onClick={() => {
            if (!activeDesk) return;
            void onNewSession(activeDesk.id);
            onOpenRun();
          }}
        >
          <Icon name="edit" size={15} />
        </button>
      }
      toolbar={
        <label className="sidebar-search">
          <Icon name="search" size={14} aria-hidden />
          <input
            type="search"
            data-testid="workspace-search"
            aria-label="Filter workspaces and sessions"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
        </label>
      }
    >
      <>
        {desks.loading && desks.desks.length === 0 ? (
          <div className="run-list__loading">
            <Skeleton.Row />
            <Skeleton.Row />
          </div>
        ) : desks.desks.length === 0 ? (
          <button
            type="button"
            data-testid="desk-new"
            className="sidebar-add"
            onClick={() => void onStartNewWorkspace()}
            disabled={busy}
          >
            <Icon name="plus" size={15} />
            {busy ? 'Picking folder…' : 'New workspace'}
          </button>
        ) : filtering && visibleDesks.length === 0 ? (
          <p className="run-list__empty">Nothing matches “{query}”.</p>
        ) : (
          <WorkspaceTree
            desks={visibleDesks}
            activeDeskId={desks.activeId}
            activeSessionId={activeDesk?.activeSessionId ?? null}
            unread={unread}
            running={live.running}
            previews={previews}
            now={now}
            collapsed={filtering ? NO_COLLAPSED : foldedDesks}
            busyDeskId={sessionBusyDeskId}
            onToggleCollapse={toggleWorkspaceCollapsed}
            onSelectSession={(id) => {
              // Picking a session always lands on its chat. Cross-desk picks
              // activate that desk too.
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
          />
        )}
        {desks.desks.length > 0 && !filtering && (
          <button
            type="button"
            data-testid="workspace-new"
            aria-label="new workspace"
            className="sidebar-add"
            disabled={busy}
            onClick={() => void onStartNewWorkspace()}
          >
            <Icon name="plus" size={15} />
            {busy ? 'Picking folder…' : 'New workspace'}
          </button>
        )}
        {onOpenChannel && <SidebarChannelsSection onOpen={onOpenChannel} />}
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
