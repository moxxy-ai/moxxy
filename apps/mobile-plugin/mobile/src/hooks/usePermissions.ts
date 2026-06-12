import { useCallback } from 'react';
import { buildAskResponseFrame } from '../clientFrames';
import type { PermissionResponseMode } from '../permissionResponse';
import type { MobileState } from '../protocol';

export function usePermissions(
  state: MobileState,
  sendFrame: (frame: Record<string, unknown>) => void,
) {
  const decidePermission = useCallback(
    (permissionId: string, mode: PermissionResponseMode) => {
      sendFrame({
        type: 'permission.decision',
        id: `decision_${permissionId}_${Date.now()}`,
        permissionId,
        decision: { mode },
      });
    },
    [sendFrame],
  );

  const respondAsk = useCallback(
    (requestId: string, response: Record<string, unknown>) => {
      sendFrame(buildAskResponseFrame({ requestId, response }));
    },
    [sendFrame],
  );

  return {
    pendingPermissions: state.pendingPermissions,
    pendingAsks: state.pendingAsks,
    decidePermission,
    respondAsk,
  };
}
