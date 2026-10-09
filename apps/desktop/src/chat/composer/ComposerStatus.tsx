import { Icon } from '@moxxy/desktop-ui';
import { DEFAULT_MODE } from '../modes/mode-meta';
import { ModeChip } from '../modes/ModeChip';

/**
 * What the next turn will do, said only when it is not the default: a mode
 * other than the default one, tool calls running unreviewed, or a goal waiting
 * for its objective. Nothing is drawn for an ordinary turn.
 */
export function ComposerStatus({
  mode,
  modeBusy,
  onLeaveMode,
  autoApprove,
  goalArmed,
  onStandDownGoal,
}: {
  /** The session's active mode, or null while it is not known. */
  readonly mode: string | null;
  readonly modeBusy: boolean;
  readonly onLeaveMode?: () => void;
  readonly autoApprove: boolean;
  readonly goalArmed: boolean;
  readonly onStandDownGoal: () => void;
}): JSX.Element | null {
  const inMode = mode !== null && mode !== DEFAULT_MODE;
  if (!inMode && !autoApprove && !goalArmed) return null;
  return (
    <div className="cmdbar__status">
      {inMode && <ModeChip mode={mode} busy={modeBusy} onLeave={onLeaveMode} />}
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
