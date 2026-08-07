import { useMemo, useState } from 'react';
import { useActionCatalog, useChat } from '@moxxy/client-core';
import { deskForWorkspace, useDesks } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Transcript } from './Transcript';
import { Composer } from './Composer';
import { AskSheet } from './AskSheet';
import { useActiveAsk } from '@moxxy/client-core';
import { Header } from './chat-surface/Header';
import { useAgentSession } from './agent-picker/useAgentSession';
import type { RunState } from '../shell/InstrumentBar';
import { ChatLoading } from './chat-surface/ChatLoading';
import { EmptyState } from './chat-surface/EmptyState';
import { ErrorToast } from './chat-surface/ErrorToast';
import { RenameWorkspaceModal } from './chat-surface/RenameWorkspaceModal';
import { ImagePreviewModal } from './image-preview/ImagePreviewModal';
import { useImagePreview } from './image-preview/useImagePreview';
import { VoiceCallSurface } from '../voice-call/VoiceCallSurface';
import { useVoiceCallRequest } from '@/lib/voiceCallRequest';
import { abortTurnPulse, transcriptSearchPulse } from '@/lib/chatPulses';
import { useDesktopVoiceCall } from '../voice-call/useDesktopVoiceCall';
import { useFocusModeToggle } from './chat-surface/useFocusModeToggle';
import { useVoiceModePresentation } from '../voice-call/useVoiceModePresentation';

interface ChatSurfaceProps {
  readonly phase: ConnectionPhase;
  readonly workspaceId: string;
  readonly sessionLoading: boolean;
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
  // Degrade a missing/short index row to 'no match' instead of throwing if the
  // index↔events alignment invariant is ever violated by a caller.
  return events.filter((_, i) => (index[i] ?? []).some((h) => h.includes(q)));
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
  sessionLoading,
}: ChatSurfaceProps): JSX.Element {
  const chat = useChat(workspaceId);
  const actionCatalog = useActionCatalog(workspaceId);
  const desks = useDesks();
  const activeAsk = useActiveAsk(workspaceId);
  const ready = phase.phase === 'connected' && !sessionLoading && !chat.loading;
  const voiceCall = useDesktopVoiceCall({
    surface: 'main',
    workspaceId,
    ready,
    chat,
    inputRequired: activeAsk !== null,
  });
  const enterFocusMode = useFocusModeToggle();
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  // Keyboard shortcuts owned by the shell, executed here where the state lives.
  transcriptSearchPulse.use(() => setSearchQuery((q) => q ?? ''));
  abortTurnPulse.use(() => {
    if (chat.activeTurnId !== null || chat.sending) void chat.abort();
  });
  const imagePreview = useImagePreview();
  // workspaceId is a SESSION id (the runner-pool routing key) — resolve the
  // desk that owns it (first sessions share their desk's id, so old ids work).
  const activeDesk = deskForWorkspace(desks.desks, workspaceId);
  // ONE session-info fetch for the whole surface. The instrument bar's telemetry
  // and the composer's mode menu both read it; two independent hooks meant two
  // round-trips per refresh and two chances to disagree about the active model.
  const agent = useAgentSession(workspaceId, !ready || chat.activeTurnId !== null || chat.sending);
  const activeSessionName =
    activeDesk?.sessions.find((sn) => sn.id === activeDesk.activeSessionId)?.name ?? null;
  // The run's state, as the bar reports it. `awaiting` outranks `running`
  // because a blocked run is the one thing the supervisor has to act on.
  const runState: RunState = activeAsk
    ? 'awaiting'
    : chat.activeTurnId !== null || chat.sending
      ? 'running'
      : chat.isEmpty
        ? 'idle'
        : 'done';

  // Precompute the searchable index ONCE per events change; the per-keystroke
  // filter then just scans it (no JSON.stringify on the keystroke path).
  const searchIndex = useMemo(() => buildSearchIndex(chat.events), [chat.events]);
  const filteredEvents = useMemo(() => {
    if (!searchQuery) return chat.events;
    return filterEventsBySearch(chat.events, searchIndex, searchQuery);
  }, [chat.events, searchQuery, searchIndex]);
  const compactTools = useMemo(() => {
    const compact = new Map<
      string,
      NonNullable<(typeof actionCatalog.tools)[number]['compact']>
    >();
    for (const tool of actionCatalog.tools) {
      if (tool.compact) compact.set(tool.name, tool.compact);
    }
    return compact;
  }, [actionCatalog]);

  const voicePresentation = useVoiceModePresentation({
    active: voiceCall.active,
    phase: voiceCall.phase,
    microphoneMuted: voiceCall.microphoneMuted,
    localPiperInstallRequired: voiceCall.localPiperInstallRequired,
    localPiperInstalling: voiceCall.localPiperInstalling,
    activeOperations: voiceCall.activeOperations,
    events: chat.events,
  });

  useVoiceCallRequest(voiceCall.open);

  const showBlockingLoading = (sessionLoading || chat.loading) && chat.isEmpty;

  if (voiceCall.active) {
    return (
      <main className="col-main col-main--flat">
        <VoiceCallSurface
          phase={voiceCall.phase}
          status={voicePresentation.status}
          orbit={voicePresentation.orbit}
          microphoneMuted={voiceCall.microphoneMuted}
          waitingSoundEnabled={voiceCall.waitingSoundEnabled}
          localPiperInstallRequired={voiceCall.localPiperInstallRequired}
          localPiperInstalling={voiceCall.localPiperInstalling}
          errorReason={voiceCall.errorReason}
          inputAnalyser={voiceCall.inputAnalyser}
          outputAnalyser={voiceCall.outputAnalyser}
          conversation={(
            <Transcript
              events={chat.events}
              extensions={chat.extensions}
              streamingText={chat.streamingText}
              streamingReasoning={chat.streamingReasoning}
              sending={chat.sending}
              workspaceId={workspaceId}
              hasOlder={chat.hasOlder}
              onReachedTop={chat.loadOlder}
              onPreviewImage={imagePreview.open}
              compactTools={compactTools}
            />
          )}
          request={activeAsk ? <AskSheet ask={activeAsk} /> : undefined}
          onClose={voiceCall.close}
          onEnterFocusMode={enterFocusMode}
          onRetry={voiceCall.retry}
          onInstallLocalPiper={voiceCall.installLocalPiper}
          onMuteMicrophone={voiceCall.muteMicrophone}
          onUnmuteMicrophone={voiceCall.unmuteMicrophone}
          onToggleWaitingSound={voiceCall.toggleWaitingSound}
        />
        <ImagePreviewModal image={imagePreview.image} onClose={imagePreview.close} />
      </main>
    );
  }

  if (showBlockingLoading) {
    return (
      <main className="col-main col-main--flat">
        <Header
          phase={phase}
          deskName={activeDesk?.name ?? null}
          sessionName={activeSessionName}
          runState={runState}
          agent={agent}
          agentDisabled={!ready}
          workspaceId={workspaceId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          canRename={activeDesk !== undefined}
          onRename={() => setRenameOpen(true)}
        />
        <div
          key={workspaceId}
          className="anim-fade-in"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <ChatLoading
            label={sessionLoading ? 'Moxxy is loading this session…' : undefined}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="col-main col-main--flat">
      <Header
        phase={phase}
        deskName={activeDesk?.name ?? null}
        sessionName={activeSessionName}
        runState={runState}
        agent={agent}
        agentDisabled={!ready}
        workspaceId={workspaceId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        canRename={activeDesk !== undefined}
        onRename={() => setRenameOpen(true)}
      />
      {/* Keyed by workspace so the message area cross-fades on switch
       *  instead of snapping — masks the content swap flicker. */}
      <div
        key={workspaceId}
        className="anim-fade-in"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {chat.isEmpty ? (
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
            onPreviewImage={imagePreview.open}
            compactTools={compactTools}
          />
        )}
      </div>
      {activeAsk && <AskSheet ask={activeAsk} />}
      <Composer
        agent={agent}
        ready={ready}
        sending={chat.sending}
        compacting={chat.compacting}
        activeTurnId={chat.activeTurnId}
        workspaceId={workspaceId}
        onOpenVoiceCall={voiceCall.open}
        onSend={(p, atts) => void chat.send(p, atts)}
        onAbort={() => void chat.abort()}
        onPreviewImage={imagePreview.open}
      />
      {chat.error && <ErrorToast text={chat.error} />}
      <ImagePreviewModal image={imagePreview.image} onClose={imagePreview.close} />
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
