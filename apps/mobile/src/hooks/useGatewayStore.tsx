/**
 * The gateway facade — one context exposing the exact store shape the
 * reference app's screens bind to (pairing / socketStatus / snapshot /
 * session / sessions / permissions / workflows / composer / autoApprove /
 * goals / compact / chat / chatEvents).
 *
 * Composition, not re-implementation: the live event folding, queue, usage
 * accounting, and ask routing all come from `@moxxy/client-core` (its
 * `ChatStoreBridge` / `ConnectionBridge` are mounted here, keyed by socket
 * generation so a re-pair re-subscribes them on the fresh client). The
 * `protocol.ts` presenter then projects those stores into the reference's
 * `MobileState` so every component reads one stable shape.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import {
  api,
  askStore,
  chatStore,
  ChatStoreBridge,
  ConnectionBridge,
  EMPTY_USAGE,
  useActiveWorkspaceId,
  useChat,
  useContextUsage,
  useQueuedTurns,
} from '@moxxy/client-core';
import type { SessionInfo } from '@moxxy/desktop-ipc-contract';
import {
  applyLocalFrame,
  buildMobileState,
  emptyLocalUiState,
  type MobileState,
} from '../protocol';
import { refreshConnectionStore } from '../connectionRefresh';
import { normalizeGatewayUrl } from '../pairingUrl';
import { usePairing, type PairingState } from './usePairing';
import { useAutoApprove } from './useAutoApprove';
import { useChatTranscript } from './useChatTranscript';
import { useCompactContext } from './useCompactContext';
import { useComposer } from './useComposer';
import { useGatewaySnapshot } from './useGatewaySnapshot';
import { useGatewaySocket, type GatewaySocketState } from './useGatewaySocket';
import { useGoals } from './useGoals';
import { usePermissions } from './usePermissions';
import { useSessionSnapshot } from './useSessionSnapshot';
import { useSessions } from './useSessions';
import { useWorkflows } from './useWorkflows';

/** session.info snapshot — fetched on (re)connect and after anything that can
 *  change the active mode/provider (the push stream doesn't carry it). */
function useSessionInfo(socket: GatewaySocketState, workspaceId: string | null, sending: boolean) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const { ready } = socket;

  const refresh = useCallback(() => {
    if (!ready) return;
    void api()
      .invoke('session.info', workspaceId ? { workspaceId } : undefined)
      .then((next) => setInfo(next))
      .catch(() => {});
  }, [ready, workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh, socket.refreshTick]);

  // A settled turn may have switched mode/provider server-side (goal mode,
  // slash commands) — refetch when sending flips off.
  useEffect(() => {
    if (!sending) refresh();
  }, [refresh, sending]);

  return { info, refresh };
}

/** `ConnectionBridge` primes the connection store only once per client mount
 *  (and only remounts per `generation`, not per reconnect) — re-prime on every
 *  successful (re)connect so a failed first dial or a runner restart (new
 *  workspace id) can't leave the app deaf on a stale/null workspace. */
function useConnectionRefresh(socket: GatewaySocketState) {
  const { ready } = socket;
  useEffect(() => {
    if (!ready) return;
    void refreshConnectionStore(api());
  }, [ready, socket.refreshTick]);
}

function useGatewayStoreValue(pairing: PairingState, socket: GatewaySocketState) {
  useConnectionRefresh(socket);
  const workspaceId = useActiveWorkspaceId();
  const chatHandle = useChat(workspaceId);
  const { info, refresh: refreshInfo } = useSessionInfo(socket, workspaceId, chatHandle.sending);
  const queue = useQueuedTurns(workspaceId);
  const usage = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getUsage(workspaceId) : EMPTY_USAGE,
  );
  const contextUsage = useContextUsage(workspaceId);
  const asks = useSyncExternalStore(askStore.subscribe, askStore.getAll);
  const autoApproveUpstream = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getAutoApprove(workspaceId) : false,
  );
  const [local, dispatchLocal] = useReducer(applyLocalFrame, undefined, emptyLocalUiState);
  const onError = useCallback(
    (message: string) => dispatchLocal({ type: 'error', message }),
    [],
  );

  // A fresh client (re-pair) starts from a clean local slice.
  useEffect(() => {
    dispatchLocal({ type: 'reset' });
  }, [socket.generation]);

  const workflowsState = useWorkflows({
    ready: socket.ready,
    refreshTick: socket.refreshTick,
    onError,
  });

  const connected = socket.status === 'connected';
  const state: MobileState = useMemo(
    () =>
      buildMobileState({
        connected,
        workspaceId,
        info,
        chat: chatHandle,
        queue,
        usage,
        contextWindow: contextUsage.contextWindow,
        asks,
        autoApprove: autoApproveUpstream,
        workflows: workflowsState.list,
        local,
      }),
    [
      asks,
      autoApproveUpstream,
      chatHandle,
      connected,
      contextUsage.contextWindow,
      info,
      local,
      queue,
      usage,
      workflowsState.list,
      workspaceId,
    ],
  );

  const snapshot = useGatewaySnapshot(state);
  const session = useSessionSnapshot(snapshot);
  const sessions = useSessions(snapshot, { onError, refreshInfo });
  const permissions = usePermissions(snapshot);
  const chat = useChatTranscript(snapshot);
  const composer = useComposer({
    workspaceId: snapshot.activeWorkspaceId,
    activeTurnId: snapshot.activeTurnId,
    transcriptionId: snapshot.transcriptionId,
    transcriptionText: snapshot.transcriptionText,
    readOnly: session.readOnly,
    send: chatHandle.send,
    abort: chatHandle.abort,
    dispatchLocal,
  });
  const compact = useCompactContext({
    readOnly: session.readOnly,
    runCommand: composer.runCommand,
  });
  const autoApprove = useAutoApprove({
    workspaceId: snapshot.activeWorkspaceId,
    enabled: snapshot.autoApprove,
    connected: snapshot.connected,
  });
  const goals = useGoals({
    workspaceId: snapshot.activeWorkspaceId,
    onError,
    refreshInfo,
  });
  const workflows = useMemo(
    () => ({
      workflows: workflowsState.workflows,
      refresh: workflowsState.refresh,
      run: workflowsState.run,
    }),
    [workflowsState.refresh, workflowsState.run, workflowsState.workflows],
  );

  return {
    pairing,
    socketStatus: socket.status,
    snapshot,
    session,
    sessions,
    permissions,
    workflows,
    composer,
    autoApprove,
    goals,
    compact,
    chat,
    chatEvents: snapshot.chatEvents,
  };
}

type GatewayStore = ReturnType<typeof useGatewayStoreValue>;

const GatewayContext = createContext<GatewayStore | null>(null);

function GatewayInner({
  pairing,
  socket,
  children,
}: PropsWithChildren<{ pairing: PairingState; socket: GatewaySocketState }>): ReactElement {
  const value = useGatewayStoreValue(pairing, socket);
  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function GatewayProvider({ children }: PropsWithChildren): ReactElement {
  const pairing = usePairing();
  const wsUrl = useMemo(
    () => (pairing.token ? normalizeGatewayUrl(pairing.gatewayUrl) : null),
    [pairing.gatewayUrl, pairing.token],
  );
  const socket = useGatewaySocket(wsUrl, pairing.token);
  return (
    <>
      {socket.ready ? (
        // Keyed by generation: a re-pair builds a new client, so the bridges
        // must re-mount to re-subscribe their event channels on it.
        <GatewayBridges key={socket.generation} />
      ) : null}
      <GatewayInner pairing={pairing} socket={socket}>
        {children}
      </GatewayInner>
    </>
  );
}

function GatewayBridges(): ReactElement {
  return (
    <>
      <ChatStoreBridge />
      <ConnectionBridge />
    </>
  );
}

export function useGatewayStore(): GatewayStore {
  const value = useContext(GatewayContext);
  if (!value) throw new Error('GatewayProvider is missing');
  return value;
}
