/**
 * How the conversation's model works: its reasoning effort and fast mode.
 *
 * Both live in the runner's session (reported in `session.info`), so every
 * client of the conversation shows the same values. A switch goes to the
 * runner, then the canonical refresh event makes every info reader re-read.
 * A choice made here is remembered for its workspace only, to hand it to the
 * next runner that workspace gets. A workspace without one starts with what
 * its runner reports: the defaults set in Settings.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { ReasoningEffort } from '@moxxy/desktop-ipc-contract';
import { SESSION_INFO_REFRESH_EVENT, type SessionInfo } from './types';

export const EFFORT_LEVELS: ReadonlyArray<ReasoningEffort> = ['off', 'low', 'medium', 'high', 'xhigh'];

/** The levels an effort menu offers: `default` only while it is the effort, since it cannot be asked for. */
export function effortLevelsFor(effort: EffortLevel): ReadonlyArray<EffortLevel> {
  return effort === 'default' ? ['off', 'default', ...EFFORT_LEVELS.slice(1)] : EFFORT_LEVELS;
}

/** A level the effort can show: one a person can set, or `default`, reasoning on at the provider's own effort. */
export type EffortLevel = ReasoningEffort | 'default';

const CHOICES_KEY = 'moxxy.model.tuning.v2';
/** One choice for every workspace, as versions before the defaults in Settings kept it. Read, never written. */
const SHARED_CHOICE_KEY = 'moxxy.model.tuning';

interface Shown {
  readonly effort: EffortLevel;
  readonly fast: boolean;
}

/** What a new runner gets back: the provider's default effort cannot be asked for, so it is not kept. */
interface Choice {
  readonly effort?: ReasoningEffort;
  readonly fast: boolean;
}

export const isSettableEffort = (effort: EffortLevel | undefined): effort is ReasoningEffort => EFFORT_LEVELS.includes(effort as ReasoningEffort);

function choiceOf(parsed: unknown): Choice | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const { effort, fast } = parsed as Partial<Choice>;
  return { ...(isSettableEffort(effort) ? { effort } : {}), fast: fast === true };
}

function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function readChoices(): Record<string, unknown> {
  const stored = readStored(CHOICES_KEY);
  return stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
}

function readChoice(workspaceId: string): Choice | null {
  return choiceOf(readChoices()[workspaceId]) ?? choiceOf(readStored(SHARED_CHOICE_KEY));
}

function saveChoice(workspaceId: string, { effort, fast }: Shown): void {
  try {
    const choice: Choice = { ...(isSettableEffort(effort) ? { effort } : {}), fast };
    localStorage.setItem(CHOICES_KEY, JSON.stringify({ ...readChoices(), [workspaceId]: choice }));
  } catch {
    // Not remembered for the next runner; the runner itself has the value.
  }
}

/** Drops the choice older versions carried from chat to chat, once the defaults in Settings say what a new one starts with. */
export function forgetSharedTuningChoice(): void {
  try {
    localStorage.removeItem(SHARED_CHOICE_KEY);
  } catch {
    // Nothing to drop where storage is unavailable.
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
        saveChoice(workspaceId, { ...latest.current.reported, ...now });
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

  // A new runner starts with the defaults: give it the choice made in this workspace, once.
  useEffect(() => {
    if (info.sessionId === undefined || restored.current === info.sessionId) return;
    restored.current = info.sessionId;
    const choice = readChoice(workspaceId);
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
    effortLevels: effortLevelsFor(effort),
    fast: pending.fast ?? reported.fast,
    canSetEffort: offered.reasoning,
    canSetFast: offered.fast,
    busy: inFlight > 0,
    error,
    // `default` cannot be asked for: the menu shows it only as the effort the runner reported.
    setEffort: (level) => (isSettableEffort(level) ? apply({ effort: level }) : Promise.resolve()),
    setFast: (enabled) => apply({ fast: enabled }),
  };
}
