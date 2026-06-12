import { api, chatStore } from '@moxxy/client-core';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { buildModelSelectorUiState, type MobileProviderInfo } from '../modelSelector';

const SESSION_INFO_RETRY_MS = 250;

interface MobileSessionInfo {
  readonly providers: ReadonlyArray<MobileProviderInfo>;
  readonly activeProvider: string | null;
  readonly activeMode: string | null;
}

interface UseModelSelectorOptions {
  readonly workspaceId: string | null;
  readonly connected: boolean;
  readonly refreshKey: string;
}

export interface MobileModelSelector {
  readonly open: boolean;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly activeMode: string | null;
  readonly activeProvider: string | null;
  readonly ui: ReturnType<typeof buildModelSelectorUiState>;
  readonly openPicker: () => void;
  readonly closePicker: () => void;
  readonly selectProvider: (provider: string) => void;
  readonly pickModel: (provider: string, model: string | null) => void;
  readonly refresh: () => void;
}

export function useModelSelector({
  workspaceId,
  connected,
  refreshKey,
}: UseModelSelectorOptions): MobileModelSelector {
  const [info, setInfo] = useState<MobileSessionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeModel = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getModel(workspaceId) : null,
  );

  const refresh = useCallback(() => {
    if (!workspaceId || !connected) return;
    void api()
      .invoke('session.info', { workspaceId })
      .then((raw) => {
        if (!isSessionInfoReady(raw)) return;
        setInfo(raw);
        setError(null);
      })
      .catch(() => undefined);
  }, [connected, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRetry = (fetchInfo: () => void): void => {
      if (!connected || cancelled) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(fetchInfo, SESSION_INFO_RETRY_MS);
    };

    const fetchInfo = (): void => {
      if (retryTimer) clearTimeout(retryTimer);
      if (!workspaceId || !connected) {
        setInfo(null);
        setSelectedProvider(null);
        setOpen(false);
        return;
      }
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
          setError(null);
        })
        .catch(() => scheduleRetry(fetchInfo));
    };

    fetchInfo();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [connected, refreshKey, workspaceId]);

  const ui = useMemo(
    () => buildModelSelectorUiState({
      providers: info?.providers ?? [],
      activeProvider: info?.activeProvider ?? null,
      activeModel,
      selectedProvider,
    }),
    [activeModel, info, selectedProvider],
  );

  const openPicker = useCallback(() => {
    if (ui.disabled) return;
    setSelectedProvider(ui.selectedProvider);
    setOpen(true);
  }, [ui.disabled, ui.selectedProvider]);

  const pickModel = useCallback(
    (provider: string, model: string | null) => {
      if (!workspaceId || !info) return;
      setError(null);
      const switchProvider =
        provider === info.activeProvider
          ? Promise.resolve()
          : api().invoke('session.setProvider', { workspaceId, provider });
      void switchProvider
        .then(() => {
          chatStore.setModel(workspaceId, model);
          setSelectedProvider(provider);
          setOpen(false);
          refresh();
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Could not switch provider.');
        });
    },
    [info, refresh, workspaceId],
  );

  return {
    open,
    error,
    disabled: ui.disabled || !connected || !workspaceId,
    activeMode: info?.activeMode ?? null,
    activeProvider: info?.activeProvider ?? null,
    ui,
    openPicker,
    closePicker: () => setOpen(false),
    selectProvider: setSelectedProvider,
    pickModel,
    refresh,
  };
}

export function createDisabledModelSelector(): MobileModelSelector {
  const ui = buildModelSelectorUiState({
    providers: [],
    activeProvider: null,
    activeModel: null,
  });
  return {
    open: false,
    error: null,
    disabled: true,
    activeMode: null,
    activeProvider: null,
    ui,
    openPicker: () => undefined,
    closePicker: () => undefined,
    selectProvider: () => undefined,
    pickModel: () => undefined,
    refresh: () => undefined,
  };
}

function isSessionInfoReady(value: MobileSessionInfo | null): value is MobileSessionInfo {
  return value !== null && value.providers.length > 0;
}
