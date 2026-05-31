/**
 * Tracks the active mode's presentation badge for a workspace so the composer
 * can surface a persistent "you're in this mode" banner. Mirrors the
 * AgentPicker's fetch-on-mount + refresh-on-event pattern, but exposes only
 * the badge — the banner doesn't care about providers/models.
 *
 * Reactivity hinges on SESSION_INFO_REFRESH_EVENT: both the Goal button
 * (Composer.startGoal) and the Mode chip (AgentPicker.onMode) dispatch it
 * after switching the mode, so the banner appears/disappears immediately
 * without waiting for a remount.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  SESSION_INFO_REFRESH_EVENT,
  type ModeBadge,
} from '@/chat/agent-picker/types';

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
    window.addEventListener(SESSION_INFO_REFRESH_EVENT, fetchBadge);
    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_INFO_REFRESH_EVENT, fetchBadge);
    };
  }, [workspaceId]);

  return badge;
}
