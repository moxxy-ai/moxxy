import { useCallback, useEffect, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import type { WebhookSummary } from '@moxxy/desktop-ipc-contract';

export interface UseWebhooks {
  readonly list: ReadonlyArray<WebhookSummary>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly setEnabled: (id: string, enabled: boolean) => Promise<void>;
  readonly deleteWebhook: (id: string) => Promise<void>;
}

/**
 * Webhook triggers for the desktop Webhooks panel — the read/enable/delete
 * mirror of {@link useScheduler}. The host reads the shared webhooks store, so
 * this lists triggers created from chat (the agent's `webhook_*` tools) too.
 */
export function useWebhooks(): UseWebhooks {
  const [list, setList] = useState<ReadonlyArray<WebhookSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const next = await api().invoke('webhooks.list');
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

  const setEnabled = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      setList((cur) => cur.map((w) => (w.id === id ? { ...w, enabled } : w)));
      try {
        const updated = await api().invoke('webhooks.setEnabled', { id, enabled });
        if (updated) {
          setList((cur) => cur.map((w) => (w.id === id ? updated : w)));
        }
        await refresh();
      } catch (e) {
        setList((cur) => cur.map((w) => (w.id === id ? { ...w, enabled: !enabled } : w)));
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  const deleteWebhook = useCallback(
    async (id: string): Promise<void> => {
      try {
        const result = await api().invoke('webhooks.delete', { id });
        if (result.deleted) {
          setList((cur) => cur.filter((w) => w.id !== id));
        }
        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  return { list, loading, error, refresh, setEnabled, deleteWebhook };
}
