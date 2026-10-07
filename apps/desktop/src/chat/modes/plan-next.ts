import { createContext, useCallback, useContext } from 'react';
import { api } from '@moxxy/client-core';
import { SESSION_INFO_REFRESH_EVENT } from '../agent-picker/types';
import { DEFAULT_MODE } from './mode-meta';
import type { ModeOutcome } from './mode-events';
import type { OutcomeAction } from './ModeOutcomeCard';
import { ModeTranscriptContext } from './ModeTranscriptContext';

/** What a person does with a finished plan besides refining it. */
export type PlanNext = 'implement' | 'goal';

interface PlanStep {
  readonly label: string;
  /** The modes to switch through, in order, before the prompt is sent. */
  readonly modes: ReadonlyArray<string>;
  readonly prompt: string;
}

/** The two ways on a plan itself names under "Next". A goal run hands back to
 *  the mode it started from, so it starts from the default one, not from planning. */
const STEPS: Record<PlanNext, PlanStep> = {
  implement: { label: 'Implement', modes: [DEFAULT_MODE], prompt: 'Implement the approved plan above.' },
  goal: { label: 'Run as goal', modes: [DEFAULT_MODE, 'goal'], prompt: 'Execute the approved plan above.' },
};

/** Both ways on, the one the plan recommends first and filled. */
export function planNextActions(
  suggests: string | undefined,
  run: (next: PlanNext) => void,
): ReadonlyArray<OutcomeAction> {
  const order: ReadonlyArray<PlanNext> = suggests === 'goal' ? ['goal', 'implement'] : ['implement', 'goal'];
  return order.map((next, index) => ({
    id: next,
    label: STEPS[next].label,
    tone: index === 0 ? 'primary' : 'neutral',
    onClick: () => run(next),
  }));
}

/** Carries a plan out, where the conversation on screen can; null where it cannot. */
export const PlanNextContext = createContext<((next: PlanNext) => void) | null>(null);

const NO_ACTIONS: ReadonlyArray<OutcomeAction> = [];

/** The answers under a plan card: only under the plan nothing has followed. */
export function usePlanActions(
  messageId: string,
  outcome: ModeOutcome | undefined,
): ReadonlyArray<OutcomeAction> {
  const run = useContext(PlanNextContext);
  const open = useContext(ModeTranscriptContext).openPlanId === messageId;
  if (run === null || !open || outcome === undefined || outcome.kind !== 'plan') return NO_ACTIONS;
  return planNextActions(outcome.suggests, run);
}

/**
 * Switches the session to the mode a plan is carried out in, then sends the
 * prompt that starts it. The switch is awaited first so the prompt cannot run
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
}): ((next: PlanNext) => void) | null {
  const run = useCallback(
    (next: PlanNext): void => {
      const step = STEPS[next];
      void (async () => {
        for (const mode of step.modes) {
          await api()
            .invoke('session.setMode', { workspaceId, mode })
            .catch(() => undefined);
        }
        window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
        onSend(step.prompt);
      })();
    },
    [workspaceId, onSend],
  );
  return ready && !busy ? run : null;
}
