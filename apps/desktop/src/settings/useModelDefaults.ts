import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { ModelDefaultsChange, StoredModelDefaults } from '@moxxy/desktop-ipc-contract';
import {
  effortLevelsFor,
  forgetSharedTuningChoice,
  isSettableEffort,
  type EffortLevel,
} from '../chat/agent-picker/useModelTuning';

interface ModelOffer {
  readonly id: string;
  readonly supportsReasoning?: boolean;
  readonly supportsFast?: boolean;
}

interface ProviderOffer {
  readonly name: string;
  readonly models: ReadonlyArray<ModelOffer>;
}

/** What the runner says can be picked: the connected providers, and the one it runs now. */
interface Offer {
  readonly active: string | null;
  readonly providers: ReadonlyArray<ProviderOffer>;
}

export interface ModelDefaultsState {
  readonly loading: boolean;
  /** The connected providers with the models each lists, plus the default itself when no list has it. */
  readonly providers: ReadonlyArray<{ readonly name: string; readonly models: ReadonlyArray<string> }>;
  /** What a new conversation runs on: the set default, else what the runner picks by itself. Null with nothing connected. */
  readonly provider: string | null;
  readonly model: string | null;
  readonly effort: EffortLevel;
  readonly effortLevels: ReadonlyArray<EffortLevel>;
  readonly fast: boolean;
  readonly canSetEffort: boolean;
  readonly canSetFast: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setModel: (provider: string, model: string) => Promise<void>;
  readonly setEffort: (effort: EffortLevel) => Promise<void>;
  readonly setFast: (enabled: boolean) => Promise<void>;
}

const NOTHING_SET: StoredModelDefaults = { provider: null, model: null, effort: 'off', fast: false };
const NOTHING_OFFERED: Offer = { active: null, providers: [] };

/**
 * Owns IPC and async state for Settings → Providers → Default model. The
 * defaults live in the config every surface starts a conversation from, so the
 * app, the terminal and the channels begin with the same model.
 */
export function useModelDefaults(): ModelDefaultsState {
  const [loading, setLoading] = useState(true);
  const [stored, setStored] = useState<StoredModelDefaults>(NOTHING_SET);
  const [offer, setOffer] = useState<Offer>(NOTHING_OFFERED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void Promise.all([api().invoke('settings.modelDefaults'), api().invoke('session.info')])
      .then(([defaults, info]) => {
        if (!current) return;
        setStored(defaults);
        if (!info) return;
        const ready = new Set(info.readyProviders);
        setOffer({
          active: info.activeProvider,
          providers: info.providers.filter((p) => ready.has(p.name)).map((p) => ({ name: p.name, models: p.models })),
        });
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  const save = useCallback(async (change: ModelDefaultsChange) => {
    setBusy(true);
    setError(null);
    try {
      await api().invoke('settings.setModelDefaults', change);
      if (change.effort !== undefined || change.fast !== undefined) forgetSharedTuningChoice();
      setStored((before) => ({
        ...before,
        ...(change.model ?? {}),
        ...(change.effort !== undefined ? { effort: change.effort } : {}),
        ...(change.fast !== undefined ? { fast: change.fast } : {}),
      }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const provider = stored.provider ?? offer.active;
  const offered = offer.providers.find((p) => p.name === provider);
  const model = stored.model ?? offered?.models[0]?.id ?? null;
  const descriptor = offered?.models.find((m) => m.id === model);
  // A model the provider does not list (a custom one) may have whatever its provider's models have.
  const like = descriptor ? [descriptor] : (offered?.models ?? []);

  return {
    loading,
    providers: offer.providers.map((p) => ({
      name: p.name,
      models: [
        ...(p.name === provider && model !== null && !p.models.some((m) => m.id === model) ? [model] : []),
        ...p.models.map((m) => m.id),
      ],
    })),
    provider: model === null ? null : provider,
    model,
    effort: stored.effort,
    effortLevels: effortLevelsFor(stored.effort),
    fast: stored.fast,
    canSetEffort: like.some((m) => m.supportsReasoning === true),
    canSetFast: like.some((m) => m.supportsFast === true),
    busy,
    error,
    setModel: (nextProvider, nextModel) => save({ model: { provider: nextProvider, model: nextModel } }),
    // `default` cannot be asked for: the menu shows it only as the effort the config holds.
    setEffort: (effort) => (isSettableEffort(effort) ? save({ effort }) : Promise.resolve()),
    setFast: (enabled) => save({ fast: enabled }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
