/**
 * Tracks the active mode's presentation badge for a workspace so a composer can
 * surface a persistent "you're in this mode" banner. Fetch-on-mount +
 * refresh-on-event: the refresh hook fires on {@link SESSION_INFO_REFRESH_EVENT}
 * (the desktop composer dispatches it after switching mode out-of-band) routed
 * through the platform {@link EventBus} capability. Without an event bus (e.g. a
 * platform that doesn't switch mode out-of-band) it still fetches once on mount.
 */

import { useEffect, useState } from 'react';
import type { ModeBadge } from '@moxxy/sdk';
import { SESSION_INFO_REFRESH_EVENT } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';
import { getPlatform } from './platform.js';

export function useActiveModeBadge(workspaceId: string): ModeBadge | null {
  const [badge, setBadge] = useState<ModeBadge | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchBadge = (): void => {
      void api()
        .invoke('session.info', { workspaceId })
        .then((raw) => {
          if (!cancelled) setBadge(raw?.activeModeBadge ?? null);
        })
        .catch(() => {});
    };
    fetchBadge();
    const off = getPlatform().eventBus?.on(SESSION_INFO_REFRESH_EVENT, fetchBadge);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [workspaceId]);

  return badge;
}
