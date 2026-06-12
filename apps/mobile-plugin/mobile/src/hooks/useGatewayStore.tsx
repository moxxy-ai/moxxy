import {
  ChatStoreBridge,
  ConnectionBridge,
  api,
  askStore,
  deskForWorkspace,
  useActiveWorkspaceId,
  useChat as useCoreChat,
  useConnection,
  useContextUsage,
  useDesks as useCoreDesks,
  useQueuedTurns,
  useSessions as useCoreDeskSessions,
  useWorkflows as useCoreWorkflows,
} from '@moxxy/client-core';
import type { UserPromptAttachment } from '@moxxy/sdk';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { buildChatTranscript } from '../chatTranscript';
import type { MobileWorkflow } from './useWorkflows';
import { useAutoApprove } from './useAutoApprove';
import { useCompactContext } from './useCompactContext';
import { useComposer } from './useComposer';
import { useGoals } from './useGoals';
import { usePairing, type PairingState } from './usePairing';
import { usePermissions } from './usePermissions';
import { useSessionSnapshot } from './useSessionSnapshot';
import { useSessions } from './useSessions';
import { emptyMobileState, type MobileState } from '../protocol';
import { textOf } from '../utils/record';

function useDisconnectedGatewayStoreValue(pairing: PairingState) {
  const sendFrame = useCallback(() => undefined, []);
  const state = useMemo<MobileState>(
    () => ({
      ...emptyMobileState(),
      session: { id: 'offline', readOnly: true },
    }),
    [],
  );
  const session = useSessionSnapshot(state);
  const sessions = useSessions(state, sendFrame);
  const permissions = usePermissions(state, sendFrame);
  const compact = useCompactContext({
    workspaceId: null,
    readOnly: true,
    sendFrame,
  });
  const composer = useComposer(sendFrame, {
    workspaceId: null,
    activeTurnId: null,
    readOnly: true,
  });

  return {
    pairing,
    socketStatus: 'idle' as const,
    snapshot: state,
    session,
    sessions,
    permissions,
    workflows: {
      workflows: [] as MobileWorkflow[],
      refresh: () => undefined,
      run: () => undefined,
    },
    composer,
    autoApprove: useAutoApprove({
      workspaceId: null,
      enabled: false,
      connected: false,
      sendFrame,
    }),
    goals: useGoals({
      workspaceId: null,
      sendFrame,
    }),
    compact,
    chat: {
      items: buildChatTranscript([], ''),
      events: [],
      streamingText: '',
      sending: false,
      activeTurnId: null,
      queue: [],
      compacting: false,
      usage: null,
      isEmpty: true,
      hasOlder: false,
      loadOlder: () => undefined,
    },
    chatEvents: [],
  };
}

function useConnectedGatewayStoreValue(pairing: PairingState) {
  const workspaceId = useActiveWorkspaceId();
  const connection = useConnection(workspaceId);
  const coreChat = useCoreChat(workspaceId);
  const coreDesks = useCoreDesks();
  const activeDesk = useMemo(
    () => deskForWorkspace(coreDesks.desks, workspaceId),
    [coreDesks.desks, workspaceId],
  );
  const coreDeskSessions = useCoreDeskSessions(activeDesk?.id ?? null);
  const queuedTurns = useQueuedTurns(workspaceId);
  const coreWorkflows = useCoreWorkflows();
  const contextUsage = useContextUsage(workspaceId);
  const pendingAsks = useSyncExternalStore(askStore.subscribe, askStore.getAll);
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [transcription, setTranscription] = useState<{ id: string; text: string } | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{
    activeMode?: string | null;
    activeProvider?: string | null;
  } | null>(null);

  const connected = connection.snapshot?.phase.phase === 'connected';

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void api()
      .invoke('session.info', { workspaceId })
      .then((info) => {
        if (!cancelled) {
          setSessionInfo({
            activeMode: info?.activeMode ?? null,
            activeProvider: info?.activeProvider ?? null,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, connected]);

  const sendFrame = useCallback(
    (frame: Record<string, unknown>) => {
      const type = textOf(frame.type);
      if (type === 'runTurn') {
        const prompt = textOf(frame.prompt);
        const inlineAttachments = Array.isArray(frame.attachments)
          ? (frame.attachments as ReadonlyArray<UserPromptAttachment>)
          : undefined;
        void coreChat.send(prompt, undefined, inlineAttachments);
        return;
      }
      if (type === 'abortTurn') {
        void coreChat.abort();
        return;
      }
      if (type === 'ask.respond') {
        const requestId = textOf(frame.requestId);
        if (requestId) askStore.respond(requestId, frame.response as Record<string, unknown>);
        return;
      }
      if (type === 'permission.decision') {
        const requestId = textOf(frame.permissionId);
        if (requestId) askStore.respond(requestId, frame.decision as Record<string, unknown>);
        return;
      }
      if (type === 'setAutoApprove') {
        const enabled = frame.enabled === true;
        setAutoApproveEnabled(enabled);
        void api()
          .invoke('session.setAutoApprove', { ...workspaceParam(workspaceId), enabled })
          .catch(() => undefined);
        return;
      }
      if (type === 'setMode') {
        const mode = textOf(frame.mode);
        if (mode) {
          void api().invoke('session.setMode', { ...workspaceParam(workspaceId), mode }).catch(() => undefined);
        }
        return;
      }
      if (type === 'runCommand') {
        const name = textOf(frame.name);
        if (name) {
          void api()
            .invoke('session.runCommand', { ...workspaceParam(workspaceId), name, args: textOf(frame.args) })
            .catch(() => undefined);
        }
        return;
      }
      if (type === 'newSession') {
        const targetDeskId = textOf(frame.workspaceId);
        const create =
          targetDeskId && targetDeskId !== activeDesk?.id
            ? api().invoke('sessions.create', { deskId: targetDeskId })
            : coreDeskSessions.create();
        void create
          .then((session) => (session ? api().invoke('sessions.setActive', { id: session.id }) : undefined))
          .catch(() => undefined);
        return;
      }
      if (type === 'selectWorkspace') {
        const id = textOf(frame.workspaceId);
        if (id) void coreDeskSessions.setActive(id).catch(() => undefined);
        return;
      }
      if (type === 'transcribe') {
        const audioBase64 = textOf(frame.audioBase64);
        if (!audioBase64) return;
        void api()
          .invoke('session.transcribe', {
            audioBase64,
            mimeType: textOf(frame.mimeType) || undefined,
          })
          .then((text) => setTranscription({ id: `transcribe-${Date.now()}`, text }))
          .catch(() => undefined);
      }
    },
    [activeDesk?.id, coreChat, coreDeskSessions, workspaceId],
  );

  const phaseInfo = readConnectedPhaseInfo(connection.snapshot?.phase);
  const activeMode = phaseInfo.activeMode ?? sessionInfo?.activeMode ?? null;
  const activeProvider = phaseInfo.activeProvider ?? sessionInfo?.activeProvider ?? null;

  const state = useMemo<MobileState>(() => {
    const sessionId = workspaceId ?? 'mobile-session';
    const desks = coreDesks.desks;
    const ownerDesk = deskForWorkspace(desks, workspaceId) ?? activeDesk ?? null;
    const activeDeskSessions = ownerDesk && coreDeskSessions.sessions.length > 0
      ? new Map(coreDeskSessions.sessions.map((session) => [session.id, session]))
      : null;
    const workspaces = desks.map((desk) => ({
      id: desk.id,
      name: desk.name,
      title: desk.name,
      cwd: desk.cwd,
      color: desk.color,
      unread: false,
    }));
    const sessions = desks.flatMap((desk) => {
      const deskSessions = desk.id === ownerDesk?.id && activeDeskSessions
        ? [...activeDeskSessions.values()]
        : desk.sessions;
      return deskSessions.map((session) => ({
        id: session.id,
        workspaceId: desk.id,
        name: session.name,
        firstPrompt: session.firstPrompt ?? session.name,
        cwd: session.cwd ?? desk.cwd,
        eventCount: session.eventCount ?? 0,
        provider: session.provider ?? null,
        model: session.model ?? null,
        live: session.id === workspaceId && connected,
        readOnly: false,
        lastActivity:
          session.lastActivity ??
          (session.createdAt > 0 ? new Date(session.createdAt).toISOString() : ''),
      }));
    });
    const usage = {
      latestPrompt: contextUsage.contextTokens,
      contextWindow: contextUsage.contextWindow,
      summary: contextUsage.summary,
      perCall: contextUsage.perCall,
    };
    return {
      ...emptyMobileState(),
      connected,
      activeWorkspaceId: workspaceId,
      workspaces,
      sessions,
      session: workspaceId ? { id: sessionId, workspaceId: ownerDesk?.id ?? sessionId, live: connected, readOnly: false } : null,
      pendingAsks: pendingAsks.filter((ask) => ask.workspaceId === workspaceId) as unknown as ReadonlyArray<Record<string, unknown>>,
      chatEvents: coreChat.events as unknown as ReadonlyArray<Record<string, unknown>>,
      streamingText: coreChat.streamingText,
      sending: coreChat.sending,
      activeTurnId: coreChat.activeTurnId,
      queue: queuedTurns as unknown as ReadonlyArray<Record<string, unknown>>,
      compacting: coreChat.compacting,
      usage,
      autoApprove: autoApproveEnabled,
      activeMode,
      activeProvider,
      transcriptionId: transcription?.id ?? null,
      transcriptionText: transcription?.text ?? null,
    };
  }, [
    activeMode,
    activeProvider,
    autoApproveEnabled,
    connected,
    contextUsage.contextTokens,
    contextUsage.contextWindow,
    contextUsage.perCall,
    contextUsage.summary,
    coreDeskSessions.sessions,
    coreDesks.desks,
    coreChat.activeTurnId,
    coreChat.compacting,
    coreChat.events,
    coreChat.sending,
    coreChat.streamingText,
    pendingAsks,
    queuedTurns,
    transcription,
    workspaceId,
    activeDesk,
  ]);

  const session = useSessionSnapshot(state);
  const sessions = useSessions(state, sendFrame);
  const permissions = usePermissions(state, sendFrame);
  const compact = useCompactContext({
    workspaceId: state.activeWorkspaceId,
    readOnly: state.session?.readOnly === true,
    sendFrame,
  });

  return {
    pairing,
    socketStatus: connected ? 'connected' as const : 'connecting' as const,
    snapshot: state,
    session,
    sessions,
    permissions,
    workflows: {
      workflows: coreWorkflows.list.map(normalizeWorkflow),
      refresh: () => {
        void coreWorkflows.refresh();
      },
      run: (name: string) => {
        void coreWorkflows.run(name);
      },
    },
    composer: useComposer(sendFrame, {
      workspaceId: state.activeWorkspaceId,
      activeTurnId: state.activeTurnId,
      transcriptionId: state.transcriptionId,
      transcriptionText: state.transcriptionText,
      readOnly: state.session?.readOnly === true,
    }),
    autoApprove: useAutoApprove({
      workspaceId: state.activeWorkspaceId,
      enabled: state.autoApprove,
      connected: state.connected,
      sendFrame,
    }),
    goals: useGoals({
      workspaceId: state.activeWorkspaceId,
      sendFrame,
    }),
    compact,
    chat: {
      items: buildChatTranscript(state.chatEvents, state.streamingText),
      events: state.chatEvents,
      streamingText: state.streamingText,
      sending: state.sending,
      activeTurnId: state.activeTurnId,
      queue: state.queue,
      compacting: state.compacting,
      usage: state.usage,
      isEmpty: state.chatEvents.length === 0 && state.streamingText.length === 0,
      hasOlder: coreChat.hasOlder,
      loadOlder: coreChat.loadOlder,
    },
    chatEvents: state.chatEvents,
  };
}

type GatewayStore =
  | ReturnType<typeof useDisconnectedGatewayStoreValue>
  | ReturnType<typeof useConnectedGatewayStoreValue>;

const GatewayContext = createContext<GatewayStore | null>(null);

export function GatewayProvider({ children }: PropsWithChildren) {
  const pairing = usePairing();
  if (!pairing.transportReady) {
    return (
      <DisconnectedGatewayProvider pairing={pairing}>
        {children}
      </DisconnectedGatewayProvider>
    );
  }
  return (
    <ConnectedGatewayProvider pairing={pairing}>
      {children}
    </ConnectedGatewayProvider>
  );
}

function DisconnectedGatewayProvider({
  children,
  pairing,
}: PropsWithChildren<{ readonly pairing: PairingState }>) {
  const value = useDisconnectedGatewayStoreValue(pairing);

  return (
    <GatewayContext.Provider value={value}>
      {children}
    </GatewayContext.Provider>
  );
}

function ConnectedGatewayProvider({
  children,
  pairing,
}: PropsWithChildren<{ readonly pairing: PairingState }>) {
  const value = useConnectedGatewayStoreValue(pairing);

  return (
    <GatewayContext.Provider value={value}>
      <ConnectionBridge />
      <ChatStoreBridge />
      {children}
    </GatewayContext.Provider>
  );
}

export function useGatewayStore(): GatewayStore {
  const value = useContext(GatewayContext);
  if (!value) throw new Error('GatewayProvider is missing');
  return value;
}

function normalizeWorkflow(value: {
  readonly name: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly scope?: string;
  readonly steps?: ReadonlyArray<unknown> | number;
  readonly triggers?: ReadonlyArray<unknown> | string;
}): MobileWorkflow {
  return {
    name: value.name,
    description: value.description ?? '',
    enabled: value.enabled === true,
    scope: value.scope ?? '',
    steps: Array.isArray(value.steps) ? value.steps.length : typeof value.steps === 'number' ? value.steps : 0,
    triggers: Array.isArray(value.triggers) ? String(value.triggers.length) : String(value.triggers ?? ''),
  };
}

function workspaceParam(workspaceId: string | null): { readonly workspaceId?: string } {
  return workspaceId ? { workspaceId } : {};
}

function readConnectedPhaseInfo(phase: unknown): {
  readonly activeMode: string | null;
  readonly activeProvider: string | null;
} {
  if (!phase || typeof phase !== 'object') return { activeMode: null, activeProvider: null };
  const record = phase as Record<string, unknown>;
  return {
    activeMode: textOf(record.activeMode) || null,
    activeProvider: textOf(record.activeProvider) || null,
  };
}
