import { useCallback, useEffect, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import type { ProviderInfo } from '../chat/agent-picker/types';

/**
 * A channel's own model (`provider::model`, see `channels.setModel`): the label
 * the panel shows, plus the picker's orchestration. The provider catalog comes
 * from the active workspace's session — the same providers the channel's runner
 * loads — and is only fetched once the picker opens.
 */

const SEPARATOR = '::';

function splitChoice(model: string | undefined): { provider: string; model: string } | null {
  if (!model) return null;
  const at = model.indexOf(SEPARATOR);
  if (at <= 0) return null;
  return { provider: model.slice(0, at), model: model.slice(at + SEPARATOR.length) };
}

export interface ChannelModelState {
  readonly label: string;
  readonly isDefault: boolean;
  readonly picking: boolean;
  readonly openPicker: () => void;
  readonly closePicker: () => void;
  readonly providers: ReadonlyArray<ProviderInfo>;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly pick: (provider: string, model: string | null) => Promise<void>;
  readonly resetToDefault: () => Promise<void>;
}

export function useChannelModel(options: {
  readonly channelId: string;
  readonly model: string | undefined;
  readonly workspaceId: string | null;
  readonly setModel: (channelId: string, model: string | null) => Promise<void>;
}): ChannelModelState {
  const { channelId, model, workspaceId, setModel } = options;
  const choice = splitChoice(model);
  const [picking, setPicking] = useState(false);
  const [providers, setProviders] = useState<ReadonlyArray<ProviderInfo>>([]);
  const [appProvider, setAppProvider] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!picking || !workspaceId) return;
    let live = true;
    api()
      .invoke('session.info', { workspaceId })
      .then((info) => {
        // null = the workspace's runner isn't attached yet; nothing to list.
        if (!live || !info) return;
        setProviders(info.providers);
        setAppProvider(info.activeProvider);
      })
      .catch((e: unknown) => {
        if (live) setError(toErrorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [picking, workspaceId]);

  const save = useCallback(
    async (next: string | null): Promise<void> => {
      setBusy(true);
      try {
        await setModel(channelId, next);
        setError(null);
        setPicking(false);
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [channelId, setModel],
  );

  const pick = useCallback(
    async (provider: string, picked: string | null): Promise<void> => {
      const modelId = picked ?? providers.find((p) => p.name === provider)?.models[0]?.id;
      if (!modelId) {
        setError(`${provider} has no models to pick`);
        return;
      }
      await save(`${provider}${SEPARATOR}${modelId}`);
    },
    [providers, save],
  );

  return {
    label: choice ? `${choice.provider} · ${choice.model}` : 'Default (same as the app)',
    isDefault: choice === null,
    picking,
    openPicker: useCallback(() => setPicking(true), []),
    closePicker: useCallback(() => setPicking(false), []),
    providers,
    activeProvider: choice?.provider ?? appProvider,
    activeModel: choice?.model ?? null,
    busy,
    error,
    pick,
    resetToDefault: useCallback(() => save(null), [save]),
  };
}
