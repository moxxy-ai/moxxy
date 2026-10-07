import { Icon } from '@moxxy/desktop-ui';
import { DEFAULT_MODE, modeMeta } from './mode-meta';

/**
 * The mode the next turn runs in, said in the composer's status row whenever
 * it is not the default one. Its × goes back to the default mode, so leaving a
 * mode never takes a trip through the menu.
 */
export function ModeChip({
  mode,
  busy,
  onLeave,
}: {
  readonly mode: string;
  /** A turn is running in this mode, so it cannot be left now. */
  readonly busy: boolean;
  /** Absent when the session has no default mode to go back to. */
  readonly onLeave?: () => void;
}): JSX.Element {
  const meta = modeMeta(mode);
  return (
    <span
      className="status-chip tip"
      data-testid="composer-mode"
      data-tone={meta.tone ?? 'accent'}
      data-tip={meta.hint || undefined}
      data-tip-side="top"
    >
      {meta.label} mode{meta.note ? ` · ${meta.note}` : ''}
      {onLeave && (
        <button
          type="button"
          className="status-chip__x"
          aria-label={`Back to ${modeMeta(DEFAULT_MODE).label} mode`}
          disabled={busy}
          onClick={onLeave}
        >
          <Icon name="x" size={10} />
        </button>
      )}
    </span>
  );
}
