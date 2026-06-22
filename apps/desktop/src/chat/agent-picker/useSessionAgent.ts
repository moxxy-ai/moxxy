/**
 * Shared session provider/model/mode state for a workspace.
 *
 * Extracted from {@link AgentPicker} so the composer chip, the sidebar
 * Chat/Agent toggle, and the top-bar model selector all read and mutate the
 * SAME session state without duplicating the fetch. They stay in lockstep via
 * the `SESSION_INFO_REFRESH_EVENT` bus: any `setMode`/`pickProviderModel`
 * dispatches it, and every consumer re-reads — so two controls for one piece of
 * state never desync.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, chatStore } from '@moxxy/client-core';
import { SESSION_INFO_REFRESH_EVENT, type SessionInfo } from './types';

export interface SessionAgent {
  /** Latest session.info, or null until the first fetch resolves. */
  readonly info: SessionInfo | null;
  /** Sticky model id chosen for this workspace (chatStore), or null. */
  readonly selectedModel: string | null;
  /** "provider/model" (or the provider, or "pick") for a compact label. */
  readonly label: string;
  /** Switch the active mode (optimistic + IPC + refresh broadcast). */
  readonly setMode: (mode: string) => Promise<void>;
  /** Switch provider (if changed) and commit the model to chatStore. */
  readonly pickProviderModel: (provider: string, model: string | null) => Promise<void>;
}

export function useSessionAgent(workspaceId: string): SessionAgent {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const selectedModel = useSyncExternalStore(chatStore.subscribe, () =>
    chatStore.getModel(workspaceId),
  );

  useEffect(() => {
    let cancelled = false;
    const fetchInfo = (): void => {
      void api()
        .invoke('session.info', { workspaceId })
        .then((raw) => {
          if (!cancelled) setInfo(raw);
        })
        .catch(() => {});
    };
    fetchInfo();
    window.addEventListener(SESSION_INFO_REFRESH_EVENT, fetchInfo);
    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_INFO_REFRESH_EVENT, fetchInfo);
    };
  }, [workspaceId]);

  const setMode = async (mode: string): Promise<void> => {
    // Optimistic flip so dependent UI updates instantly; the broadcast below
    // makes every consumer re-read and confirm.
    setInfo((cur) => (cur ? { ...cur, activeMode: mode } : cur));
    try {
      await api().invoke('session.setMode', { workspaceId, mode });
    } catch {
      /* the refresh restores the true value */
    }
    window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
  };

  const pickProviderModel = async (
    provider: string,
    model: string | null,
  ): Promise<void> => {
    if (info && provider !== info.activeProvider) {
      try {
        await api().invoke('session.setProvider', { workspaceId, provider });
      } catch {
        return;
      }
    }
    chatStore.setModel(workspaceId, model);
    window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
  };

  const label = selectedModel
    ? `${info?.activeProvider ?? '—'}/${selectedModel}`
    : info?.activeProvider ?? 'pick';

  return { info, selectedModel, label, setMode, pickProviderModel };
}
