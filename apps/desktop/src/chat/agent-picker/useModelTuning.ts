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

/** A level the effort can show: one a person can set, or `default`, reasoning on at the provider's own effort. */
export type EffortLevel = ReasoningEffort | 'default';

const CHOICE_KEY = 'moxxy.model.tuning';

interface Shown {
  readonly effort: EffortLevel;
  readonly fast: boolean;
}

/** What a new runner gets back: the provider's default effort cannot be asked for, so it is not kept. */
interface Choice {
  readonly effort?: ReasoningEffort;
  readonly fast: boolean;
}

const settable = (effort: EffortLevel | undefined): effort is ReasoningEffort => EFFORT_LEVELS.includes(effort as ReasoningEffort);

function readChoice(): Choice | null {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Choice> | null) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...(settable(parsed.effort) ? { effort: parsed.effort } : {}), fast: parsed.fast === true };
  } catch {
    return null;
  }
}

function saveChoice({ effort, fast }: Shown): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ ...(settable(effort) ? { effort } : {}), fast }));
  } catch {
    // Not remembered for the next runner; the runner itself has the value.
  }
}

export interface ModelTuning {
  readonly effort: EffortLevel;
  /** The levels the effort menu offers: `default` only while it is the effort. */
  readonly effortLevels: ReadonlyArray<EffortLevel>;
  readonly fast: boolean;
  /** The model in use thinks before answering, so its effort can be set. */
  readonly canSetEffort: boolean;
  /** The provider serves the model in use on a faster tier. */
  readonly canSetFast: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setEffort: (effort: EffortLevel) => Promise<void>;
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
  const reported: Shown = { effort: info.reasoningEffort ?? 'off', fast: info.fast === true };
  const [pending, setPending] = useState<Partial<Choice>>({});
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef<string | undefined>(undefined);
  // Switches go to the runner one after another, so the last one made is the one that stays; each reads what the
  // ones before it changed from these refs, not from the render it was made in.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ reported, pending: {} as Partial<Choice> });
  latest.current.reported = reported;

  // A fresh report from the runner replaces what this client last asked for.
  useEffect(() => {
    latest.current.pending = {};
    setPending({});
  }, [info.reasoningEffort, info.fast]);

  const apply = (change: Partial<Choice>): Promise<void> => {
    setInFlight((count) => count + 1);
    const done = queue.current.then(async () => {
      setError(null);
      try {
        if (change.effort !== undefined) await api().invoke('settings.setReasoning', { workspaceId, effort: change.effort });
        if (change.fast !== undefined) await api().invoke('settings.setFast', { workspaceId, enabled: change.fast });
        const now = { ...latest.current.pending, ...change };
        latest.current.pending = now;
        setPending(now);
        saveChoice({ ...latest.current.reported, ...now });
        window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setInFlight((count) => count - 1);
      }
    });
    queue.current = done;
    return done;
  };

  // A new runner starts plain: give it the person's last choice, once.
  useEffect(() => {
    if (info.sessionId === undefined || restored.current === info.sessionId) return;
    restored.current = info.sessionId;
    const choice = readChoice();
    if (!choice) return;
    const change: Partial<Choice> = {
      ...(choice.effort !== undefined && choice.effort !== reported.effort ? { effort: choice.effort } : {}),
      ...(choice.fast !== reported.fast ? { fast: choice.fast } : {}),
    };
    if (Object.keys(change).length > 0) void apply(change);
    // Only a new runner restores; the values themselves are read when it does.
  }, [info.sessionId]);

  const offered = offers(info, model);
  const effort = pending.effort ?? reported.effort;
  return {
    effort,
    effortLevels: effort === 'default' ? ['off', 'default', ...EFFORT_LEVELS.slice(1)] : EFFORT_LEVELS,
    fast: pending.fast ?? reported.fast,
    canSetEffort: offered.reasoning,
    canSetFast: offered.fast,
    busy: inFlight > 0,
    error,
    // `default` cannot be asked for: the menu shows it only as the effort the runner reported.
    setEffort: (level) => (settable(level) ? apply({ effort: level }) : Promise.resolve()),
    setFast: (enabled) => apply({ fast: enabled }),
  };
}
