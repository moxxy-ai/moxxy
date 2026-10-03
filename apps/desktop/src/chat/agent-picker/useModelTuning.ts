/**
 * How the conversation's model works: its reasoning effort and fast mode.
 *
 * Both live in the runner's session (reported in `session.info`), so every
 * client of the conversation shows the same values. A switch goes to the
 * runner, then the canonical refresh event makes every info reader re-read.
 * The person's last choice is remembered here only to hand it to the next
 * runner the workspace gets (a runner starts with neither set).
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { ReasoningEffort } from '@moxxy/desktop-ipc-contract';
import { SESSION_INFO_REFRESH_EVENT, type SessionInfo } from './types';

export const EFFORT_LEVELS: ReadonlyArray<ReasoningEffort> = ['off', 'low', 'medium', 'high', 'xhigh'];

const CHOICE_KEY = 'moxxy.model.tuning';

interface Choice {
  readonly effort: ReasoningEffort;
  readonly fast: boolean;
}

function readChoice(): Choice | null {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Choice>) : null;
    if (!parsed || !EFFORT_LEVELS.includes(parsed.effort as ReasoningEffort)) return null;
    return { effort: parsed.effort as ReasoningEffort, fast: parsed.fast === true };
  } catch {
    return null;
  }
}

function saveChoice(choice: Choice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Not remembered for the next runner; the runner itself has the value.
  }
}

export interface ModelTuning {
  readonly effort: ReasoningEffort;
  readonly fast: boolean;
  /** The model in use thinks before answering, so its effort can be set. */
  readonly canSetEffort: boolean;
  /** The provider serves the model in use on a faster tier. */
  readonly canSetFast: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setEffort: (effort: ReasoningEffort) => Promise<void>;
  readonly setFast: (enabled: boolean) => Promise<void>;
}

/** What the model in use offers; an unknown model id (a custom or live one) offers what any of its provider's models do. */
function offers(info: SessionInfo, model: string | null): { reasoning: boolean; fast: boolean } {
  const provider = info.providers.find((p) => p.name === info.activeProvider);
  const models = provider?.models ?? [];
  const descriptor = model === null ? models[0] : models.find((m) => m.id === model);
  const candidates = descriptor ? [descriptor] : models;
  return {
    reasoning: candidates.some((m) => m.supportsReasoning === true),
    fast: candidates.some((m) => m.supportsFast === true),
  };
}

export function useModelTuning(workspaceId: string, info: SessionInfo, model: string | null): ModelTuning {
  const reported: Choice = { effort: info.reasoningEffort ?? 'off', fast: info.fast === true };
  const [pending, setPending] = useState<Partial<Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef<string | undefined>(undefined);

  // A fresh report from the runner replaces what this client last asked for.
  useEffect(() => setPending({}), [info.reasoningEffort, info.fast]);

  const apply = async (change: Partial<Choice>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (change.effort !== undefined) await api().invoke('settings.setReasoning', { workspaceId, effort: change.effort });
      if (change.fast !== undefined) await api().invoke('settings.setFast', { workspaceId, enabled: change.fast });
      setPending((current) => ({ ...current, ...change }));
      saveChoice({ ...reported, ...pending, ...change });
      window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // A new runner starts plain: give it the person's last choice, once.
  useEffect(() => {
    if (info.sessionId === undefined || restored.current === info.sessionId) return;
    restored.current = info.sessionId;
    const choice = readChoice();
    if (!choice) return;
    const change: Partial<Choice> = {
      ...(choice.effort !== reported.effort ? { effort: choice.effort } : {}),
      ...(choice.fast !== reported.fast ? { fast: choice.fast } : {}),
    };
    if (Object.keys(change).length > 0) void apply(change);
    // Only a new runner restores; the values themselves are read when it does.
  }, [info.sessionId]);

  const offered = offers(info, model);
  return {
    effort: pending.effort ?? reported.effort,
    fast: pending.fast ?? reported.fast,
    canSetEffort: offered.reasoning,
    canSetFast: offered.fast,
    busy,
    error,
    setEffort: (effort) => apply({ effort }),
    setFast: (enabled) => apply({ fast: enabled }),
  };
}
