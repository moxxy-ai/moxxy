/**
 * "Skip" pill shown beside the live thinking indicator (z.ai). NOTE: there is
 * no reasoning-only skip primitive in moxxy — this aborts the whole turn (the
 * same `session.abortTurn` the composer's stop button uses). Labelled "Skip"
 * per the z.ai design; the action is an abort.
 */
export function SkipButton({ onSkip }: { readonly onSkip: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="btn-ghost"
      data-testid="thinking-skip"
      onClick={onSkip}
      title="Skip (stops the current turn)"
      style={{
        padding: '3px 12px',
        fontSize: 12.5,
        fontWeight: 600,
        borderRadius: 999,
        border: '1px solid var(--color-card-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-text-muted)',
      }}
    >
      Skip
    </button>
  );
}
