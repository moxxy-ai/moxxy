import { useCallback, useEffect, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import type { ChannelEntry, ChannelRunMode, ChannelRuntimeStatus } from '@moxxy/desktop-ipc-contract';

export interface UseChannels {
  readonly list: ReadonlyArray<ChannelEntry>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  /** Save a channel's secrets/settings (values keyed by ChannelConfigField.name).
   *  Blank fields are ignored host-side so an untouched password isn't wiped. */
  readonly saveConfig: (channelId: string, values: Record<string, string>) => Promise<void>;
  readonly start: (channelId: string) => Promise<void>;
  readonly stop: (channelId: string) => Promise<void>;
  /** Set the bot's own model (`provider::model`), or `null` for the default. */
  readonly setModel: (channelId: string, model: string | null) => Promise<void>;
  /** Choose how the bot runs (manual / with the app / background service). */
  readonly setRunMode: (channelId: string, mode: ChannelRunMode) => Promise<void>;
}

/** Host-derived status fields the supervisor's runtime push doesn't carry. */
function keepHostState(prev: ChannelRuntimeStatus, next: ChannelRuntimeStatus): ChannelRuntimeStatus {
  const model = next.model ?? prev.model;
  const runMode = next.runMode ?? prev.runMode;
  const background = next.background ?? prev.background;
  return {
    ...next,
    ...(model ? { model } : {}),
    ...(runMode ? { runMode } : {}),
    ...(background ? { background } : {}),
  };
}

/**
 * Drives the desktop "Channels" panel: lists the runnable channels (Slack,
 * Telegram) with their config descriptors + live status, and starts/stops/configs
 * them on their own dedicated runners. Subscribes to `channels.status` so a
 * channel's card reflects start/stop/crash and the Request URL becoming available
 * without polling.
 */
export function useChannels(): UseChannels {
  const [list, setList] = useState<ReadonlyArray<ChannelEntry>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Command replies are authoritative (a reset clears `model`); the supervisor's
  // `channels.status` push only knows the process, so it keeps the host state.
  const applyStatus = useCallback((status: ChannelRuntimeStatus): void => {
    setList((cur) => cur.map((e) => (e.descriptor.id === status.id ? { ...e, status } : e)));
  }, []);
  const applyRuntimePush = useCallback((status: ChannelRuntimeStatus): void => {
    setList((cur) =>
      cur.map((e) => (e.descriptor.id === status.id ? { ...e, status: keepHostState(e.status, status) } : e)),
    );
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const next = await api().invoke('channels.list');
      setList(next);
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates (start / stop / crash / Request URL ready) — no polling.
  useEffect(() => api().subscribe('channels.status', applyRuntimePush), [applyRuntimePush]);

  const saveConfig = useCallback(
    async (channelId: string, values: Record<string, string>): Promise<void> => {
      try {
        applyStatus(await api().invoke('channels.saveConfig', { channelId, values }));
        setError(null);
      } catch (e) {
        setError(toErrorMessage(e));
        throw e;
      }
    },
    [applyStatus],
  );

  const start = useCallback(
    async (channelId: string): Promise<void> => {
      try {
        applyStatus(await api().invoke('channels.start', { channelId }));
        setError(null);
      } catch (e) {
        setError(toErrorMessage(e));
        throw e;
      }
    },
    [applyStatus],
  );

  const stop = useCallback(
    async (channelId: string): Promise<void> => {
      try {
        applyStatus(await api().invoke('channels.stop', { channelId }));
        setError(null);
      } catch (e) {
        setError(toErrorMessage(e));
        throw e;
      }
    },
    [applyStatus],
  );

  const setModel = useCallback(
    async (channelId: string, model: string | null): Promise<void> => {
      try {
        applyStatus(await api().invoke('channels.setModel', { channelId, model }));
        setError(null);
      } catch (e) {
        setError(toErrorMessage(e));
        throw e;
      }
    },
    [applyStatus],
  );

  const setRunMode = useCallback(
    async (channelId: string, mode: ChannelRunMode): Promise<void> => {
      try {
        applyStatus(await api().invoke('channels.setRunMode', { channelId, mode }));
        setError(null);
      } catch (e) {
        setError(toErrorMessage(e));
        throw e;
      }
    },
    [applyStatus],
  );

  return { list, loading, error, refresh, saveConfig, start, stop, setModel, setRunMode };
}
