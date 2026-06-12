/**
 * Bridges the runner's registry-change push to the renderer's EventBus.
 *
 * The host forwards the runner's `info.changed` notification as the
 * `session.info.changed` IPC event (any provider/mode/MCP/workflow mutation —
 * including ones made by TOOLS inside a turn, e.g. `provider_add`). This hook
 * re-emits it as {@link SESSION_INFO_REFRESH_EVENT} on the platform EventBus,
 * the signal every info-derived view already listens for (`useSettings`,
 * `useActiveModeBadge`, `useActionCatalog`, the agent picker's raw window
 * listener). Mount it ONCE near the app root.
 */

import { useEffect } from 'react';
import { SESSION_INFO_REFRESH_EVENT } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';
import { getPlatform } from './platform.js';

export function useSessionInfoBridge(): void {
  useEffect(() => {
    return api().subscribe('session.info.changed', () => {
      getPlatform().eventBus?.emit(SESSION_INFO_REFRESH_EVENT);
    });
  }, []);
}
