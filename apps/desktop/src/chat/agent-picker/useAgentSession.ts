/**
 * Session-info state + the provider/model/mode mutations the composer needs,
 * extracted from the old `AgentPicker` container so two presentations can
 * share one fetch: the Mode submenu in the composer's "+" overflow and the
 * model/context control on the right of the toolbar.
 *
 * Owns the `session.info` fetch (with the fresh-runner retry), the shared
 * per-session model override (`chatStore` mirror), and the optimistic mode
 * flip. Switching a provider hits `session.setProvider`; picking a model
 * commits `session.setModel`; switching a mode commits `session.setMode` then
 * dispatches the canonical refresh event so every info-derived surface re-reads.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, chatStore, useConnection } from '@moxxy/client-core';
import { SESSION_INFO_REFRESH_EVENT, type SessionInfo } from './types';
import { isSessionInfoReady } from '../../app-session-readiness';

/** Modes hidden from the chat mode picker — collaboration is launched from the
 *  Collaborate tab (single-flight), and its peer modes are internal. */
const COLLAB_MODES: ReadonlySet<string> = new Set([
  'collaborative',
  'collab-architect',
  'collab-peer',
]);

const SESSION_INFO_RETRY_MS = 250;

export interface AgentSession {
  /** Latest ready session.info, or null until the runner exposes providers. */
  readonly info: SessionInfo | null;
  /** Shared per-session model override (null = runner's default). */
  readonly selectedModel: string | null;
  /** Selectable modes (collaboration + internal peers filtered out). */
  readonly modes: ReadonlyArray<string>;
  /** Optimistically switch the active mode (fire-and-forget RPC + refresh). */
  readonly onMode: (next: string) => void;
  /** Commit a provider (if changed) + model selection. */
  readonly onPickProviderModel: (
    provider: string,
    model: string | null,
  ) => Promise<void>;
}

export function useAgentSession(
  workspaceId: string,
  disabled: boolean,
): AgentSession {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const { snapshot } = useConnection(workspaceId);
  const connectedRefreshKey =
    snapshot?.phase.phase === 'connected'
      ? `${snapshot.phase.sessionId}:${snapshot.phase.activeProvider ?? ''}:${snapshot.phase.activeMode ?? ''}`
      : snapshot?.phase.phase ?? 'missing';
  const runnerConnected = snapshot?.phase.phase === 'connected';
  const selectedModel = useSyncExternalStore(chatStore.subscribe, () =>
    chatStore.getModel(workspaceId),
  );

  const refresh = (): void => {
    void api()
      .invoke('session.info', { workspaceId })
      .then((raw) => setInfo(raw))
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const scheduleRetry = (fetchInfo: () => void): void => {
      if (cancelled) return;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(fetchInfo, SESSION_INFO_RETRY_MS);
    };
    setInfo(null);
    const fetchInfo = (): void => {
      window.clearTimeout(retryTimer);
      void api()
        .invoke('session.info', { workspaceId })
        .then((raw) => {
          if (cancelled) return;
          if (!isSessionInfoReady(raw)) {
            setInfo(null);
            scheduleRetry(fetchInfo);
            return;
          }
          setInfo(raw);
        })
        .catch(() => scheduleRetry(fetchInfo));
    };
    fetchInfo();
    // Re-fetch when something switched the mode out-of-band (e.g. the Goal
    // button) so the picker doesn't show a stale value.
    window.addEventListener(SESSION_INFO_REFRESH_EVENT, fetchInfo);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener(SESSION_INFO_REFRESH_EVENT, fetchInfo);
    };
  }, [workspaceId, disabled, connectedRefreshKey, runnerConnected]);

  const onMode = (next: string): void => {
    // Optimistic flip so the picker updates instantly — the IPC fires a
    // fire-and-forget RPC, then the refresh below confirms. Without this the
    // value visibly snaps back to the old one for a beat.
    setInfo((cur) => (cur ? { ...cur, activeMode: next } : cur));
    void (async () => {
      try {
        await api().invoke('session.setMode', { workspaceId, mode: next });
      } catch {
        /* fall through — the refresh below restores the true value */
      }
      // Canonical "mode changed" signal: this hook's own listener re-reads
      // (confirming the flip + the new badge) and the composer's goal banner
      // lights up / clears — so a picker-driven switch behaves like the Goal
      // button, which already dispatches this event.
      window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
    })();
  };

  const onPickProviderModel = async (
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
    try {
      await api().invoke('session.setModel', { workspaceId, model });
    } catch {
      return;
    }
    chatStore.setModel(workspaceId, model);
    refresh();
  };

  const modes = info ? info.modes.filter((m) => !COLLAB_MODES.has(m)) : [];

  return { info, selectedModel, modes, onMode, onPickProviderModel };
}
