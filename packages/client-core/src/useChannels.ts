import { useCallback, useEffect, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import type { ChannelEntry, ChannelRuntimeStatus } from '@moxxy/desktop-ipc-contract';

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

  const applyStatus = useCallback((status: ChannelRuntimeStatus): void => {
    setList((cur) => cur.map((e) => (e.descriptor.id === status.id ? { ...e, status } : e)));
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
  useEffect(() => api().subscribe('channels.status', applyStatus), [applyStatus]);

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

  return { list, loading, error, refresh, saveConfig, start, stop };
}
