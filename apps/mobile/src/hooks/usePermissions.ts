import { useCallback } from 'react';
import { askStore } from '@moxxy/client-core';
import { toAskResponse, toPermissionMode, type MobileState } from '../protocol';

/**
 * Pending interactive prompts. On this transport BOTH permissions and
 * approvals ride the unified ask channel (`ask.request` → `ask.respond`), so
 * `pendingPermissions` is structurally empty and the AskSheet renders
 * everything from `pendingAsks`. Responding goes through client-core's
 * askStore, which drops the ask locally and replies to the host.
 */
export function usePermissions(state: MobileState) {
  const respondAsk = useCallback((requestId: string, response: Record<string, unknown>) => {
    askStore.respond(requestId, toAskResponse(response));
  }, []);

  const decidePermission = useCallback(
    (permissionId: string, mode: 'allow_once' | 'allow_session' | 'allow_always' | 'deny') => {
      askStore.respond(permissionId, { mode: toPermissionMode(mode) });
    },
    [],
  );

  return {
    pendingPermissions: state.pendingPermissions,
    pendingAsks: state.pendingAsks,
    decidePermission,
    respondAsk,
  };
}
