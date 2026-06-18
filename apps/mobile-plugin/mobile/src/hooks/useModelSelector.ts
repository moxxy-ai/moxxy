import { api, chatStore } from '@moxxy/client-core';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { buildModelSelectorUiState, type MobileProviderInfo } from '../modelSelector';
import { buildModeSelectorUiState, type MobileModeBadge } from '../modeSelector';

const SESSION_INFO_RETRY_MS = 250;

interface MobileSessionInfo {
  readonly providers: ReadonlyArray<MobileProviderInfo>;
  readonly modes: ReadonlyArray<string>;
  readonly activeProvider: string | null;
  readonly activeMode: string | null;
  readonly activeModeBadge: MobileModeBadge | null;
}

interface UseModelSelectorOptions {
  readonly workspaceId: string | null;
  readonly connected: boolean;
  readonly refreshKey: string;
}

export interface MobileModelSelector {
  readonly open: boolean;
  readonly modeOpen: boolean;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly activeMode: string | null;
  readonly activeModeBadge: MobileModeBadge | null;
  readonly activeProvider: string | null;
  readonly ui: ReturnType<typeof buildModelSelectorUiState>;
  readonly modeUi: ReturnType<typeof buildModeSelectorUiState>;
  readonly openPicker: () => void;
  readonly closePicker: () => void;
  readonly openModePicker: () => void;
  readonly closeModePicker: () => void;
  readonly selectProvider: (provider: string) => void;
  readonly pickModel: (provider: string, model: string | null) => void;
  readonly pickMode: (mode: string) => void;
  readonly refresh: () => void;
}

export function useModelSelector({
  workspaceId,
  connected,
  refreshKey,
}: UseModelSelectorOptions): MobileModelSelector {
  const [info, setInfo] = useState<MobileSessionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
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
        setModeOpen(false);
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
  const modeUi = useMemo(
    () => buildModeSelectorUiState({
      modes: info?.modes ?? [],
      activeMode: info?.activeMode ?? null,
      activeModeBadge: info?.activeModeBadge ?? null,
    }),
    [info],
  );

  const openPicker = useCallback(() => {
    if (ui.disabled) return;
    setSelectedProvider(ui.selectedProvider);
    setModeOpen(false);
    setOpen(true);
  }, [ui.disabled, ui.selectedProvider]);

  const openModePicker = useCallback(() => {
    if (modeUi.disabled) return;
    setOpen(false);
    setModeOpen(true);
  }, [modeUi.disabled]);

  const pickModel = useCallback(
    (provider: string, model: string | null) => {
      if (!workspaceId || !info) return;
      setError(null);
      const switchProvider =
        provider === info.activeProvider
          ? Promise.resolve()
          : api().invoke('session.setProvider', { workspaceId, provider });
      void switchProvider
        .then(() => api().invoke('session.setModel', { workspaceId, model }))
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

  const pickMode = useCallback(
    (mode: string) => {
      if (!workspaceId || !info) return;
      setError(null);
      setInfo((cur) => (cur ? { ...cur, activeMode: mode, activeModeBadge: null } : cur));
      void api()
        .invoke('session.setMode', { workspaceId, mode })
        .then(() => {
          setModeOpen(false);
          refresh();
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Could not switch mode.');
          refresh();
        });
    },
    [info, refresh, workspaceId],
  );

  return {
    open,
    modeOpen,
    error,
    disabled: ui.disabled || !connected || !workspaceId,
    activeMode: info?.activeMode ?? null,
    activeModeBadge: info?.activeModeBadge ?? null,
    activeProvider: info?.activeProvider ?? null,
    ui,
    modeUi,
    openPicker,
    closePicker: () => setOpen(false),
    openModePicker,
    closeModePicker: () => setModeOpen(false),
    selectProvider: setSelectedProvider,
    pickModel,
    pickMode,
    refresh,
  };
}

export function createDisabledModelSelector(): MobileModelSelector {
  const ui = buildModelSelectorUiState({
    providers: [],
    activeProvider: null,
    activeModel: null,
  });
  const modeUi = buildModeSelectorUiState({
    modes: [],
    activeMode: null,
    activeModeBadge: null,
  });
  return {
    open: false,
    modeOpen: false,
    error: null,
    disabled: true,
    activeMode: null,
    activeModeBadge: null,
    activeProvider: null,
    ui,
    modeUi,
    openPicker: () => undefined,
    closePicker: () => undefined,
    openModePicker: () => undefined,
    closeModePicker: () => undefined,
    selectProvider: () => undefined,
    pickModel: () => undefined,
    pickMode: () => undefined,
    refresh: () => undefined,
  };
}

function isSessionInfoReady(value: MobileSessionInfo | null): value is MobileSessionInfo {
  return value !== null && value.providers.length > 0;
}
