/**
 * Inline agent pickers in the composer toolbar.
 *
 *   [ Model: openai/gpt-4o ▾ ] [ Mode: default ▾ ]
 *
 * The Model chip is a single entry point that opens a two-column
 * modal (providers on the left, models on the right). Switching a
 * provider hits the workspace's session over IPC (session.setProvider)
 * and resets the sticky model; picking a model commits it to the
 * chatStore for that workspace and is passed to every runTurn.
 *
 * The Mode chip stays as a flat native-select chip because there's no
 * sub-list to disclose — modes are flat.
 *
 * This container owns the session.info fetch + optimistic mutations and
 * delegates the chips / modal to the focused modules under this dir.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, chatStore, useConnection } from '@moxxy/client-core';
import { ChipButton } from './ChipButton';
import { ChipSelect } from './ChipSelect';
import { ProviderModelPicker } from './ProviderModelPicker';
import { SESSION_INFO_REFRESH_EVENT, type SessionInfo } from './types';
import { isSessionInfoReady } from '../../app-session-readiness';

/** Modes hidden from the chat mode chip — collaboration is launched from the
 *  Collaborate tab (single-flight), and its peer modes are internal. */
const COLLAB_MODES: ReadonlySet<string> = new Set([
  'collaborative',
  'collab-architect',
  'collab-peer',
]);

const SESSION_INFO_RETRY_MS = 250;

export function AgentPicker({
  workspaceId,
  disabled,
}: {
  readonly workspaceId: string;
  readonly disabled: boolean;
}): JSX.Element | null {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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
      if (!runnerConnected || cancelled) return;
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
    // button) so the Mode chip doesn't show a stale value.
    window.addEventListener(SESSION_INFO_REFRESH_EVENT, fetchInfo);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener(SESSION_INFO_REFRESH_EVENT, fetchInfo);
    };
  }, [workspaceId, disabled, connectedRefreshKey, runnerConnected]);

  if (!info) return null;

  const onMode = async (next: string): Promise<void> => {
    // Optimistic flip so the chip updates instantly — the IPC fires
    // a fire-and-forget RPC to the runner, then the renderer relies
    // on a session.info refresh to confirm. Without this the chip
    // visibly snaps back to the old value for a beat.
    setInfo((cur) => (cur ? { ...cur, activeMode: next } : cur));
    try {
      await api().invoke('session.setMode', { workspaceId, mode: next });
    } catch {
      /* fall through — the refresh below restores the true value */
    }
    // Canonical "mode changed" signal: this picker's own listener re-reads
    // (confirming the flip + the new badge), and the composer's goal banner
    // lights up / clears — so a chip-driven switch behaves like the Goal
    // button, which already dispatches this event.
    window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
  };

  const onPickProviderModel = async (
    provider: string,
    model: string | null,
  ): Promise<void> => {
    if (provider !== info.activeProvider) {
      try {
        await api().invoke('session.setProvider', { workspaceId, provider });
      } catch {
        return;
      }
    }
    chatStore.setModel(workspaceId, model);
    setPickerOpen(false);
    refresh();
  };

  const modelLabel = selectedModel
    ? `${info.activeProvider ?? '—'}/${selectedModel}`
    : info.activeProvider ?? 'pick';

  return (
    <>
      <ChipButton
        label="Model"
        value={modelLabel}
        disabled={disabled}
        onClick={() => setPickerOpen(true)}
      />
      <ChipSelect
        label="Mode"
        value={info.activeMode ?? ''}
        // Collaboration is launched from the Collaborate tab (one at a time),
        // not as a chat mode — hide collaborative + its internal peer modes.
        options={info.modes.filter((m) => !COLLAB_MODES.has(m))}
        badge={info.activeModeBadge}
        disabled={disabled || info.modes.length === 0}
        onChange={(v) => void onMode(v)}
      />
      {pickerOpen && (
        <ProviderModelPicker
          providers={info.providers}
          activeProvider={info.activeProvider}
          activeModel={selectedModel}
          onPick={(p, m) => void onPickProviderModel(p, m)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
