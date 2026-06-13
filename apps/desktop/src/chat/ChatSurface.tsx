import { useMemo, useState } from 'react';
import { useChat } from '@moxxy/client-core';
import { deskForWorkspace, useDesks } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Transcript } from './Transcript';
import { Composer } from './Composer';
import { AskSheet } from './AskSheet';
import { useActiveAsk } from '@moxxy/client-core';
import { Header } from './chat-surface/Header';
import { ChatLoading } from './chat-surface/ChatLoading';
import { EmptyState } from './chat-surface/EmptyState';
import { SuggestedActions } from './chat-surface/SuggestedActions';
import { ErrorToast } from './chat-surface/ErrorToast';
import { RenameWorkspaceModal } from './chat-surface/RenameWorkspaceModal';
import { deriveSuggestions } from './chat-surface/suggestions';

interface ChatSurfaceProps {
  readonly phase: ConnectionPhase;
  readonly workspaceId: string;
  readonly railPane: import('../shell/ContextRail').RailPane | null;
  readonly onPickPane: (pane: import('../shell/ContextRail').RailPane) => void;
  readonly sessionLoading: boolean;
  readonly onView: (v: import('../shell/ViewHeader').View) => void;
}

/** Stable empty reference for the searching code path (no extensions
 *  while a search filter is active). */
const EMPTY_EXTENSIONS: ReadonlyArray<import('@moxxy/client-core').Extension> = Object.freeze([]);

type ChatEvent = import('@moxxy/sdk').MoxxyEvent;

/**
 * Per-event lowercased searchable haystacks, computed ONCE per events change so
 * a keystroke in the search box doesn't re-`JSON.stringify` every tool input
 * (then throw it away) over the whole log. Each entry holds exactly the strings
 * the old per-event predicate tested with `.includes(q)`.
 */
export function buildSearchIndex(
  events: ReadonlyArray<ChatEvent>,
): ReadonlyArray<ReadonlyArray<string>> {
  return events.map((e) => {
    if (e.type === 'user_prompt') return [e.text.toLowerCase()];
    if (e.type === 'assistant_message') return [e.content.toLowerCase()];
    if (e.type === 'tool_call_requested') {
      return [e.name.toLowerCase(), JSON.stringify(e.input).toLowerCase()];
    }
    if (e.type === 'error') return [e.message.toLowerCase()];
    return [];
  });
}

/**
 * Filter `events` by `query` using a prebuilt {@link buildSearchIndex}. Result
 * is byte-identical to the prior inline predicate: `[X].some(includes)` ===
 * `X.includes(q)` and `[X,Y].some(...)` === `X.includes(q) || Y.includes(q)`.
 */
export function filterEventsBySearch(
  events: ReadonlyArray<ChatEvent>,
  index: ReadonlyArray<ReadonlyArray<string>>,
  query: string,
): ReadonlyArray<ChatEvent> {
  const q = query.toLowerCase();
  return events.filter((_, i) => index[i]!.some((h) => h.includes(q)));
}

/**
 * Chat pane — the rightmost column. Card-style transcript with a
 * sticky header, suggested-action chips below the latest assistant
 * message, and a rounded composer floating against the pane's bottom.
 *
 * Streaming is visualised inside BlockView (a blinking block-cursor
 * trails the assistant text while chunks are still arriving). Auto-
 * scroll follows the bottom unless the user scrolls up to read.
 */
export function ChatSurface({
  phase,
  workspaceId,
  railPane,
  onPickPane,
  sessionLoading,
  onView,
}: ChatSurfaceProps): JSX.Element {
  const chat = useChat(workspaceId);
  const desks = useDesks();
  const activeAsk = useActiveAsk(workspaceId);
  const ready = phase.phase === 'connected';
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  // workspaceId is a SESSION id (the runner-pool routing key) — resolve the
  // desk that owns it (first sessions share their desk's id, so old ids work).
  const activeDesk = deskForWorkspace(desks.desks, workspaceId);

  // Precompute the searchable index ONCE per events change; the per-keystroke
  // filter then just scans it (no JSON.stringify on the keystroke path).
  const searchIndex = useMemo(() => buildSearchIndex(chat.events), [chat.events]);
  const filteredEvents = useMemo(() => {
    if (!searchQuery) return chat.events;
    return filterEventsBySearch(chat.events, searchIndex, searchQuery);
  }, [chat.events, searchQuery, searchIndex]);

  if (sessionLoading) {
    return (
      <main className="col-main col-main--flat">
        <Header
          phase={phase}
          railOpen={railOpen}
          onShowRail={onShowRail}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          canRename={activeDesk !== undefined}
          onRename={() => setRenameOpen(true)}
          onView={onView}
        />
        <div
          key={workspaceId}
          className="anim-fade-in"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <ChatLoading label="Moxxy is loading this session…" />
        </div>
      </main>
    );
  }

  return (
    <main className="col-main col-main--flat">
      <Header
        phase={phase}
        workspaceId={workspaceId}
        railPane={railPane}
        onPickPane={onPickPane}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        canRename={activeDesk !== undefined}
        onRename={() => setRenameOpen(true)}
        onView={onView}
      />
      {/* Keyed by workspace so the message area cross-fades on switch
       *  instead of snapping — masks the content swap flicker. */}
      <div
        key={workspaceId}
        className="anim-fade-in"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {chat.loading ? (
          <ChatLoading />
        ) : chat.isEmpty ? (
          <EmptyState ready={ready} />
        ) : (
          <Transcript
            events={filteredEvents}
            extensions={searchQuery ? EMPTY_EXTENSIONS : chat.extensions}
            streamingText={searchQuery ? '' : chat.streamingText}
            streamingReasoning={searchQuery ? '' : chat.streamingReasoning}
            sending={chat.sending}
            workspaceId={workspaceId}
            hasOlder={!searchQuery && chat.hasOlder}
            onReachedTop={chat.loadOlder}
          />
        )}
      </div>
      {ready && !chat.sending && !chat.isEmpty && (
        <SuggestedActions
          suggestions={deriveSuggestions(chat.events)}
          onPick={(p) => void chat.send(p)}
        />
      )}
      {activeAsk && <AskSheet ask={activeAsk} />}
      <Composer
        ready={ready}
        sending={chat.sending}
        compacting={chat.compacting}
        activeTurnId={chat.activeTurnId}
        workspaceId={workspaceId}
        onSend={(p, atts) => void chat.send(p, atts)}
        onAbort={() => void chat.abort()}
      />
      {chat.error && <ErrorToast text={chat.error} />}
      {renameOpen && activeDesk && (
        <RenameWorkspaceModal
          desk={activeDesk}
          onClose={() => setRenameOpen(false)}
          onSubmit={async (name) => {
            await desks.rename(activeDesk.id, name);
            setRenameOpen(false);
          }}
        />
      )}
    </main>
  );
}
