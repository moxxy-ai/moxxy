import {
  ChatStoreBridge,
  ConnectionBridge,
  api,
  askStore,
  chatStore,
  deskForWorkspace,
  isSessionFeatureLoading,
  toErrorMessage,
  useActiveWorkspaceId,
  useChat as useCoreChat,
  useConnection,
  useContextUsage,
  useDesks as useCoreDesks,
  useQueuedTurns,
  useSessions as useCoreDeskSessions,
  useScheduler as useCoreScheduler,
  useSessionInfoReady,
  useWorkflows as useCoreWorkflows,
} from '@moxxy/client-core';
import type { UserPromptAttachment } from '@moxxy/sdk';
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { useAutoApprove } from './useAutoApprove';
import { useCompactContext } from './useCompactContext';
import { useComposer } from './useComposer';
import { useGoals } from './useGoals';
import { useChatTranscript } from './useChatTranscript';
import { createDisabledModelSelector, useModelSelector } from './useModelSelector';
import { disconnectedMobileWorkflowStore, useMobileWorkflows } from './useMobileWorkflows';
import { disconnectedMobileSchedulerStore, useMobileScheduler } from './useMobileScheduler';
import { usePairing, type PairingState } from './usePairing';
import { usePermissions } from './usePermissions';
import { useSessionSnapshot } from './useSessionSnapshot';
import { useSessions } from './useSessions';
import { routeSelectWorkspaceFrame } from '../gatewayFrameRouting';
import { buildSelectedSessionRecord } from '../mobileSessionSelection';
import { buildMobileWorkspaceSessionRecords } from '../mobileWorkspaceSessions';
import { emptyMobileState, type MobileState } from '../protocol';
import { normalizeSessionCommandResult, type SessionCommandResult } from '../sessionCommandResult';
import { textOf } from '../utils/record';
import { useThrottledValue } from './useThrottledValue';

/** Live-stream coalescing window (~25fps). Bounds how often a token stream
 *  rebuilds the transcript + reconciles the list + auto-scrolls. */
const STREAM_THROTTLE_MS = 40;

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
  const chatTranscript = useChatTranscript(state);
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
    gatewayConnected: false,
    socketStatus: 'idle' as const,
    snapshot: state,
    sessionLoading: false,
    session,
    sessions,
    permissions,
    workflows: disconnectedMobileWorkflowStore,
    scheduler: disconnectedMobileSchedulerStore,
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
      ...chatTranscript,
      hasOlder: false,
      loadOlder: () => undefined,
    },
    chatEvents: [],
    modelSelector: createDisabledModelSelector(),
  };
}

function useConnectedGatewayStoreValue(pairing: PairingState) {
  const workspaceId = useActiveWorkspaceId();
  const connection = useConnection(workspaceId);
  const sessionInfoReady = useSessionInfoReady(workspaceId, connection.snapshot?.phase);
  const sessionLoading = isSessionFeatureLoading({
    workspaceId,
    phase: connection.snapshot?.phase,
    sessionInfoReady,
  });
  const coreChat = useCoreChat(workspaceId);
  const coreDesks = useCoreDesks();
  const activeDesk = useMemo(
    () => deskForWorkspace(coreDesks.desks, workspaceId),
    [coreDesks.desks, workspaceId],
  );
  const coreDeskSessions = useCoreDeskSessions(activeDesk?.id ?? null);
  const queuedTurns = useQueuedTurns(workspaceId);
  const coreWorkflows = useCoreWorkflows();
  const workflows = useMobileWorkflows(coreWorkflows);
  const coreScheduler = useCoreScheduler();
  const scheduler = useMobileScheduler(coreScheduler);
  const contextUsage = useContextUsage(workspaceId);
  const pendingAsks = useSyncExternalStore(askStore.subscribe, askStore.getAll);
  const autoApproveEnabled = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getAutoApprove(workspaceId) : false,
  );
  const [transcription, setTranscription] = useState<{ id: string; text: string } | null>(null);

  const connected = connection.snapshot?.phase.phase === 'connected';
  const phaseInfo = readConnectedPhaseInfo(connection.snapshot?.phase);
  const connectedRefreshKey =
    connection.snapshot?.phase.phase === 'connected'
      ? `${connection.snapshot.phase.sessionId}:${connection.snapshot.phase.activeProvider ?? ''}:${connection.snapshot.phase.activeMode ?? ''}`
      : connection.snapshot?.phase.phase ?? 'missing';
  const modelSelector = useModelSelector({
    workspaceId,
    connected,
    refreshKey: connectedRefreshKey,
  });

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
        if (workspaceId) chatStore.setAutoApprove(workspaceId, enabled);
        void api()
          .invoke('session.setAutoApprove', { ...workspaceParam(workspaceId), enabled })
          .catch(() => undefined);
        return;
      }
      if (type === 'setMode') {
        const mode = textOf(frame.mode);
        if (mode) {
          void api()
            .invoke('session.setMode', { ...workspaceParam(workspaceId), mode })
            .then(() => modelSelector.refresh())
            .catch(() => undefined);
        }
        return;
      }
      if (type === 'runCommand') {
        const name = textOf(frame.name);
        const args = textOf(frame.args);
        const targetWorkspaceId = textOf(frame.workspaceId) || workspaceId;
        if (name) {
          void api()
            .invoke('session.runCommand', { ...workspaceParam(targetWorkspaceId), name, args })
            .then(async (result) => {
              if (!targetWorkspaceId) return;
              const normalized = normalizeSessionCommandResult(name, args, result as SessionCommandResult);
              if (normalized.sideEffect === 'clear') {
                chatStore.clear(targetWorkspaceId);
              } else if (normalized.sideEffect === 'new') {
                chatStore.clear(targetWorkspaceId);
                await api().invoke('session.newSession', { workspaceId: targetWorkspaceId });
              }
              if (normalized.dispatch) {
                chatStore.dispatch(targetWorkspaceId, normalized.dispatch);
              }
            })
            .catch((err) => {
              if (!targetWorkspaceId) return;
              chatStore.dispatch(targetWorkspaceId, {
                type: 'action_result',
                commandName: name,
                argsLine: args,
                tone: 'error',
                text: toErrorMessage(err),
              });
            });
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
      if (routeSelectWorkspaceFrame(frame, coreDesks)) return;
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
    [activeDesk?.id, coreChat, coreDeskSessions, coreDesks, modelSelector, workspaceId],
  );

  const activeMode = phaseInfo.activeMode ?? modelSelector.activeMode ?? null;
  const activeProvider = phaseInfo.activeProvider ?? modelSelector.activeProvider ?? null;
  const modeBadge = modelSelector.activeModeBadge;

  // Throttle the live token stream so the heavy transcript rebuild + list
  // reconciliation + auto-scroll run at a bounded rate instead of once per chunk.
  const throttledStreamingText = useThrottledValue(
    coreChat.streamingText,
    STREAM_THROTTLE_MS,
    (text) => text === '',
  );

  const state = useMemo<MobileState>(() => {
    const desks = coreDesks.desks;
    const ownerDesk = deskForWorkspace(desks, workspaceId) ?? activeDesk ?? null;
    const workspaces = desks.map((desk) => ({
      id: desk.id,
      name: desk.name,
      title: desk.name,
      cwd: desk.cwd,
      color: desk.color,
      unread: false,
    }));
    const sessions = buildMobileWorkspaceSessionRecords({
      desks,
      activeSessionId: workspaceId,
      connected,
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
      session: buildSelectedSessionRecord({
        workspaceId,
        ownerWorkspaceId: ownerDesk?.id ?? null,
        connected,
      }),
      pendingAsks: pendingAsks.filter((ask) => ask.workspaceId === workspaceId) as unknown as ReadonlyArray<Record<string, unknown>>,
      chatEvents: coreChat.events as unknown as ReadonlyArray<Record<string, unknown>>,
      streamingText: throttledStreamingText,
      sending: coreChat.sending,
      activeTurnId: coreChat.activeTurnId,
      queue: queuedTurns as unknown as ReadonlyArray<Record<string, unknown>>,
      compacting: coreChat.compacting,
      usage,
      autoApprove: autoApproveEnabled,
      activeMode,
      activeProvider,
      modeBadge,
      transcriptionId: transcription?.id ?? null,
      transcriptionText: transcription?.text ?? null,
    };
  }, [
    activeMode,
    activeProvider,
    modeBadge,
    autoApproveEnabled,
    connected,
    contextUsage.contextTokens,
    contextUsage.contextWindow,
    contextUsage.perCall,
    contextUsage.summary,
    coreDesks.desks,
    coreChat.activeTurnId,
    coreChat.compacting,
    coreChat.events,
    coreChat.sending,
    throttledStreamingText,
    pendingAsks,
    queuedTurns,
    transcription,
    workspaceId,
    activeDesk,
  ]);

  const session = useSessionSnapshot(state);
  const sessions = useSessions(state, sendFrame, {
    renameSession: coreDesks.renameSession,
    removeSession: coreDesks.removeSession,
    // The drawer addresses workspaces by the mobile workspace id, but the desk
    // store's rename/remove expect the DESK id — map through deskForWorkspace.
    renameWorkspace: (workspaceId, name) => coreDesks.rename(deskForWorkspace(coreDesks.desks, workspaceId)?.id ?? workspaceId, name),
    removeWorkspace: (workspaceId) => coreDesks.remove(deskForWorkspace(coreDesks.desks, workspaceId)?.id ?? workspaceId),
  });
  const permissions = usePermissions(state, sendFrame);
  const chatTranscript = useChatTranscript(state);
  const compact = useCompactContext({
    workspaceId: state.activeWorkspaceId,
    readOnly: state.session?.readOnly === true,
    sendFrame,
  });

  return {
    pairing,
    gatewayConnected: true,
    socketStatus: 'connected' as const,
    snapshot: state,
    sessionLoading,
    session,
    sessions,
    permissions,
    workflows,
    scheduler,
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
      ...chatTranscript,
      hasOlder: coreChat.hasOlder,
      loadOlder: coreChat.loadOlder,
    },
    chatEvents: state.chatEvents,
    modelSelector,
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
