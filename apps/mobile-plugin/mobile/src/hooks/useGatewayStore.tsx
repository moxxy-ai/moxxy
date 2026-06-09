import { createContext, useContext, type PropsWithChildren } from 'react';
import { useAutoApprove } from './useAutoApprove';
import { useChatTranscript } from './useChatTranscript';
import { useComposer } from './useComposer';
import { useGatewaySnapshot } from './useGatewaySnapshot';
import { useGatewaySocket } from './useGatewaySocket';
import { useGoals } from './useGoals';
import { usePairing } from './usePairing';
import { usePermissions } from './usePermissions';
import { useSessionSnapshot } from './useSessionSnapshot';
import { useSessions } from './useSessions';
import { useWorkflows } from './useWorkflows';

function useGatewayStoreValue() {
  const pairing = usePairing();
  const socket = useGatewaySocket(pairing.gatewayUrl, pairing.token);
  const snapshot = useGatewaySnapshot(socket.state);
  const chat = useChatTranscript(snapshot);
  const session = useSessionSnapshot(snapshot);
  const sessions = useSessions(snapshot, socket.sendFrame);
  const permissions = usePermissions(snapshot, socket.sendFrame);
  const workflows = useWorkflows(snapshot, socket.sendFrame);
  return {
    pairing,
    socketStatus: socket.status,
    snapshot,
    session,
    sessions,
    permissions,
    workflows,
    composer: useComposer(socket.sendFrame, {
      workspaceId: snapshot.activeWorkspaceId,
      activeTurnId: snapshot.activeTurnId,
      transcriptionId: snapshot.transcriptionId,
      transcriptionText: snapshot.transcriptionText,
      readOnly: snapshot.session?.readOnly === true,
    }),
    autoApprove: useAutoApprove({
      workspaceId: snapshot.activeWorkspaceId,
      enabled: snapshot.autoApprove,
      connected: snapshot.connected,
      sendFrame: socket.sendFrame,
    }),
    goals: useGoals({
      workspaceId: snapshot.activeWorkspaceId,
      sendFrame: socket.sendFrame,
    }),
    chat,
    chatEvents: snapshot.chatEvents,
  };
}

type GatewayStore = ReturnType<typeof useGatewayStoreValue>;

const GatewayContext = createContext<GatewayStore | null>(null);

export function GatewayProvider({ children }: PropsWithChildren) {
  return <GatewayContext.Provider value={useGatewayStoreValue()}>{children}</GatewayContext.Provider>;
}

export function useGatewayStore(): GatewayStore {
  const value = useContext(GatewayContext);
  if (!value) throw new Error('GatewayProvider is missing');
  return value;
}
