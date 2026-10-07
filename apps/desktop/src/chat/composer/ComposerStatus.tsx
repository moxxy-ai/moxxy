import { Icon } from '@moxxy/desktop-ui';

/**
 * What the next turn will do, said only when it is not the default: tool calls
 * running unreviewed, or a goal waiting for its objective. Nothing is drawn
 * for an ordinary turn.
 */
export function ComposerStatus({
  autoApprove,
  goalArmed,
  onStandDownGoal,
}: {
  readonly autoApprove: boolean;
  readonly goalArmed: boolean;
  readonly onStandDownGoal: () => void;
}): JSX.Element | null {
  if (!autoApprove && !goalArmed) return null;
  return (
    <div className="cmdbar__status">
      {autoApprove && (
        <span className="status-chip" data-tone="warn" data-testid="composer-auto-approve">
          Auto-approve on
        </span>
      )}
      {goalArmed && (
        <button
          type="button"
          className="status-chip"
          data-tone="accent"
          data-testid="composer-goal-armed"
          title="Stand down (Esc)"
          onClick={onStandDownGoal}
        >
          Goal <Icon name="x" size={10} />
        </button>
      )}
    </div>
  );
}
