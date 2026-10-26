import { useMemo } from 'react';
import { turnStepList } from '@moxxy/chat-model';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { StepListDisplay } from '@moxxy/sdk/tool-display';

/** The agent's list of steps in the turn running now; null between turns or when it keeps none. */
export function useTurnSteps(events: ReadonlyArray<MoxxyEvent>, running: boolean): StepListDisplay | null {
  const steps = useMemo(() => turnStepList(events), [events]);
  return running && steps && steps.steps.length > 0 ? steps : null;
}
