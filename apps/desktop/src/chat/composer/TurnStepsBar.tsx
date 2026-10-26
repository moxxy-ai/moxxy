import { useState } from 'react';
import { stepListProgress, type StepListDisplay } from '@moxxy/sdk/tool-display';
import { StepItems } from '../blocks/StepList';

/**
 * Where the agent is in its list while the turn runs: "Step 2 of 3 · Create
 * b.txt". The list itself sits higher up in the conversation; pressing the bar
 * shows it here too.
 */
export function TurnStepsBar({ steps }: { readonly steps: StepListDisplay }): JSX.Element {
  const [open, setOpen] = useState(false);
  const { done, total, current } = stepListProgress(steps);
  const label = current ? `Step ${Math.min(done + 1, total)} of ${total}` : `${done} of ${total} steps done`;
  return (
    <div className="turn-steps" data-testid="composer-turn-steps">
      <button type="button" className="turn-steps__bar" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="turn-steps__count">{label}</span>
        {current ? <span className="turn-steps__current">{current.text}</span> : null}
      </button>
      {open ? <StepItems display={steps} /> : null}
    </div>
  );
}
