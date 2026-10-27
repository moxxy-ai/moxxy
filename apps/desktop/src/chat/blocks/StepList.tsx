import { stepListOf, type StepListBlock } from '@moxxy/chat-model';
import { stepListProgress, type ListedStep, type StepListDisplay } from '@moxxy/sdk/tool-display';
import { Icon } from '@moxxy/desktop-ui';

const STATUS_LABEL: Record<ListedStep['status'], string> = {
  completed: 'done',
  in_progress: 'in progress',
  pending: 'to do',
  cancelled: 'cancelled',
};

/** "1 of 3 done": how far a list is, as its heading says it. */
export function stepsDoneLabel(display: StepListDisplay): string {
  const { done, total } = stepListProgress(display);
  return `${done} of ${total} done`;
}

/** An agent's steps, each with its state: ✓ done, a filled dot in progress, an empty one to do. */
export function StepItems({ display }: { readonly display: StepListDisplay }): JSX.Element {
  return (
    <ol className="step-list__items">
      {display.steps.map((step, index) => (
        <li key={index} className="step-list__item" data-status={step.status}>
          <span className="step-list__mark" aria-hidden>
            {step.status === 'completed' ? <Icon name="check" size={12} /> : null}
          </span>
          <span className="step-list__text">{step.text}</span>
          <span className="sr-only">, {STATUS_LABEL[step.status]}</span>
        </li>
      ))}
    </ol>
  );
}

/** The agent's list of steps for a turn, as it stands after the turn's last change. */
export function StepListView({ block }: { readonly block: StepListBlock }): JSX.Element | null {
  const display = stepListOf(block);
  if (!display || display.steps.length === 0) return null;
  return (
    <div className="step-list" data-testid="block-step-list">
      <div className="step-list__head">
        <span className="step-list__title">Steps</span>
        <span className="step-list__count">{stepsDoneLabel(display)}</span>
      </div>
      {display.explanation ? <p className="step-list__why">{display.explanation}</p> : null}
      <StepItems display={display} />
    </div>
  );
}
