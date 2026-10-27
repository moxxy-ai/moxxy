import { createContext, useCallback, useContext, useState } from 'react';
import { api } from '@moxxy/client-core';
import { SESSION_INFO_REFRESH_EVENT } from '../agent-picker/types';
import { DEFAULT_MODE } from './mode-meta';
import type { ModeOutcome } from './mode-events';
import type { OutcomeAction, PlanRewrite } from './ModeOutcomeCard';
import { ModeTranscriptContext } from './ModeTranscriptContext';
import { usePlanDismissal } from './plan-dismissals';

/** What a person does with a finished plan: carry it out, or have it written again. */
export type PlanNext = 'implement' | 'goal' | 'rewrite';
/** The ways to carry a plan out. */
type CarryOut = Exclude<PlanNext, 'rewrite'>;

interface PlanStep {
  readonly label: string;
  /** The modes to switch through, in order, before the prompt is sent. */
  readonly modes: ReadonlyArray<string>;
  readonly prompt: (note: string) => string;
}

/** The two ways on a plan itself names under "Next", and the way back into planning.
 *  A goal run hands back to the mode it started from, so it starts from the default
 *  one, not from planning. */
const STEPS: Record<PlanNext, PlanStep> = {
  implement: { label: 'Implement', modes: [DEFAULT_MODE], prompt: () => 'Implement the approved plan above.' },
  goal: { label: 'Run as goal', modes: [DEFAULT_MODE, 'goal'], prompt: () => 'Execute the approved plan above.' },
  rewrite: { label: 'Rewrite', modes: ['plan'], prompt: (note) => `Rewrite the plan above. What does not fit:\n\n${note}` },
};

/** Both ways on, the one the plan recommends first and filled. */
export function planNextActions(
  suggests: string | undefined,
  run: (next: PlanNext) => void,
): ReadonlyArray<OutcomeAction> {
  const order: ReadonlyArray<CarryOut> = suggests === 'goal' ? ['goal', 'implement'] : ['implement', 'goal'];
  return order.map((next, index) => ({
    id: next,
    label: STEPS[next].label,
    tone: index === 0 ? 'primary' : 'neutral',
    onClick: () => run(next),
  }));
}

/** Answers a plan; a rewrite carries what the person said does not fit. */
export type AnswerPlan = (next: PlanNext, note?: string) => void;

/** Answers a plan, where the conversation on screen can; null where it cannot. */
export const PlanNextContext = createContext<AnswerPlan | null>(null);

export interface PlanCard {
  /** The heading to draw: the plan's own, saying so once it was dismissed. */
  readonly outcome: ModeOutcome | undefined;
  readonly actions: ReadonlyArray<OutcomeAction>;
  /** Open while the person writes what should change; the answers wait meanwhile. */
  readonly rewrite: PlanRewrite | null;
}

const NO_ACTIONS: ReadonlyArray<OutcomeAction> = [];

/**
 * The answers under a plan card, only under the plan nothing has followed: carry it out,
 * write it again with what does not fit, or dismiss it.
 */
export function usePlanCard(messageId: string, outcome: ModeOutcome | undefined): PlanCard {
  const run = useContext(PlanNextContext);
  const open = useContext(ModeTranscriptContext).openPlanId === messageId;
  const { dismissed, dismiss } = usePlanDismissal(messageId);
  const [note, setNote] = useState<string | null>(null);
  if (outcome === undefined || outcome.kind !== 'plan') return { outcome, actions: NO_ACTIONS, rewrite: null };
  if (dismissed) {
    return { outcome: { ...outcome, facts: [...outcome.facts, { text: 'Dismissed' }] }, actions: NO_ACTIONS, rewrite: null };
  }
  if (run === null || !open) return { outcome, actions: NO_ACTIONS, rewrite: null };
  if (note !== null) {
    const send = (): void => {
      if (note.trim() === '') return;
      run('rewrite', note.trim());
      setNote(null);
    };
    return { outcome, actions: NO_ACTIONS, rewrite: { note, setNote, send, cancel: () => setNote(null) } };
  }
  const actions: ReadonlyArray<OutcomeAction> = [
    ...planNextActions(outcome.suggests, run),
    { id: 'rewrite', label: STEPS.rewrite.label, tone: 'neutral', onClick: () => setNote('') },
    { id: 'dismiss', label: 'Dismiss', tone: 'neutral', onClick: dismiss },
  ];
  return { outcome, actions, rewrite: null };
}

/**
 * Switches the session to the mode a plan is carried out (or written again) in,
 * then sends the prompt that starts it. The switch is awaited first so the prompt cannot run
 * as another round of planning. Null while a turn runs or the runner is away.
 */
export function usePlanNext({
  workspaceId,
  ready,
  busy,
  onSend,
}: {
  readonly workspaceId: string;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly onSend: (prompt: string) => void;
}): AnswerPlan | null {
  const run = useCallback(
    (next: PlanNext, note = ''): void => {
      const step = STEPS[next];
      void (async () => {
        for (const mode of step.modes) {
          await api()
            .invoke('session.setMode', { workspaceId, mode })
            .catch(() => undefined);
        }
        window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
        onSend(step.prompt(note));
      })();
    },
    [workspaceId, onSend],
  );
  return ready && !busy ? run : null;
}
