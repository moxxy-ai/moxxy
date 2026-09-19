import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import type { ProviderInfo } from './types';

interface DiscoveryRecord {
  readonly ids?: ReadonlyArray<string>;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error?: string;
}

export interface LiveProviderModels {
  readonly canFetchLive: boolean;
  readonly models: ReadonlyArray<string>;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly error?: string;
  readonly refresh: () => Promise<void>;
}

/**
 * Own live-catalog orchestration outside the model picker presentation. Each
 * provider keeps its last successful catalog so a temporary server outage does
 * not make already-discovered choices disappear.
 */
export function useLiveProviderModels(
  providers: ReadonlyArray<ProviderInfo>,
  providerName: string,
): LiveProviderModels {
  const [records, setRecords] = useState<Record<string, DiscoveryRecord>>({});
  const mounted = useRef(true);
  const provider = providers.find((candidate) => candidate.name === providerName);
  const canFetchLive = provider?.supportsLiveModelDiscovery === true;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchModels = useCallback(async (name: string): Promise<void> => {
    setRecords((current) => ({
      ...current,
      [name]: {
        ...(current[name]?.ids ? { ids: current[name].ids } : {}),
        status: 'loading',
      },
    }));
    try {
      const ids = await api().invoke('settings.fetchProviderModels', { provider: name });
      if (!mounted.current) return;
      setRecords((current) => ({
        ...current,
        [name]: { ids, status: 'ready' },
      }));
    } catch (error) {
      if (!mounted.current) return;
      setRecords((current) => ({
        ...current,
        [name]: {
          ...(current[name]?.ids ? { ids: current[name].ids } : {}),
          status: 'error',
          error: toErrorMessage(error),
        },
      }));
    }
  }, []);

  const record = records[providerName];
  useEffect(() => {
    if (!providerName || !canFetchLive || record) return;
    void fetchModels(providerName);
  }, [canFetchLive, fetchModels, providerName, record]);

  const advertised = provider?.models.map((model) => model.id) ?? [];
  return {
    canFetchLive,
    models: canFetchLive ? (record?.ids ?? []) : advertised,
    status: canFetchLive ? (record?.status ?? 'idle') : 'ready',
    ...(record?.error ? { error: record.error } : {}),
    refresh: () => fetchModels(providerName),
  };
}
